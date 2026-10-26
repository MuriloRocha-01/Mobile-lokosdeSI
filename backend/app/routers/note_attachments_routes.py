"""Anexos das notas: fotos (PNG, JPEG, GIF, WebP) e PDFs, guardados no HD em NOTES_ROOT\\<id da nota>\\."""

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import quota
from ..auth import get_current_user
from ..config import NOTES_ROOT
from ..database import get_db
from ..models import Attachment, User
from ..schemas import AttachmentOut
from ..storage import resolve_under
from .notes_routes import _get_owned

router = APIRouter(prefix="/notes/{note_id}/attachments", tags=["anexos"])

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_PDF_BYTES = 50 * 1024 * 1024
MAX_ATTACHMENTS_PER_NOTE = 200
CHUNK_SIZE = 1024 * 1024

# Formatos aceitos, reconhecidos pelo CONTEÚDO do arquivo (o nome/tipo enviado pode mentir). SVG fica de fora
# de propósito: pode carregar scripts.
_IMAGE_TYPES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
)


def _detect(head: bytes) -> tuple[str, str, str] | None:
    """(image|pdf, Content-Type, extensão) pelo começo do arquivo, ou None se o formato não é aceito."""
    for magic, content_type, extension in _IMAGE_TYPES:
        if head.startswith(magic):
            return "image", content_type, extension
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image", "image/webp", ".webp"
    if head.startswith(b"%PDF-"):
        return "pdf", "application/pdf", ".pdf"
    return None


def _url(attachment: Attachment) -> str:
    return f"/notes/{attachment.note_id}/attachments/{attachment.id}/file"


def _markdown(attachment: Attachment) -> str:
    """Como o anexo fica no texto da nota: foto = imagem do Markdown; PDF = link com o tamanho no título."""
    name = re.sub(r"[\[\]()]", "", attachment.file_name)
    if attachment.file_type == "image":
        return f"![{Path(name).stem}]({_url(attachment)})"
    return f'[{name}]({_url(attachment)} "pdf:{attachment.size}")'


def _out(attachment: Attachment) -> AttachmentOut:
    return AttachmentOut(
        id=attachment.id,
        file_name=attachment.file_name,
        file_type=attachment.file_type,  # type: ignore[arg-type]
        size=attachment.size,
        created_at=attachment.created_at,
        url=_url(attachment),
        markdown=_markdown(attachment),
    )


def _display_name(filename: str | None, extension: str) -> str:
    name = (filename or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f]", "", name).strip()[:200]
    return name or f"anexo{extension}"


def _owned_attachment(db: Session, user: User, note_id: int, attachment_id: int) -> Attachment:
    _get_owned(db, user, note_id)
    attachment = db.scalar(select(Attachment).where(Attachment.id == attachment_id, Attachment.note_id == note_id))
    if attachment is None:
        raise HTTPException(status_code=404, detail="Anexo não encontrado.")
    return attachment


@router.get("", response_model=list[AttachmentOut])
def list_attachments(note_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[AttachmentOut]:
    note = _get_owned(db, user, note_id)
    return [_out(attachment) for attachment in note.attachments]


@router.post("", response_model=AttachmentOut, status_code=201)
async def upload_attachment(
    note_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AttachmentOut:
    """Recebe uma foto ou um PDF, grava no HD e devolve o que o editor precisa para mostrá-lo na nota."""
    note = _get_owned(db, user, note_id)
    total = db.scalar(select(func.count()).select_from(Attachment).where(Attachment.note_id == note_id)) or 0
    if total >= MAX_ATTACHMENTS_PER_NOTE:
        raise HTTPException(status_code=400, detail=f"Cada nota aceita até {MAX_ATTACHMENTS_PER_NOTE} anexos.")

    head = await file.read(CHUNK_SIZE)
    detected = _detect(head)
    if detected is None:
        raise HTTPException(status_code=400, detail="Formato não aceito. Envie uma foto (PNG, JPEG, GIF ou WebP) ou um PDF.")
    kind, content_type, extension = detected
    limit = MAX_PDF_BYTES if kind == "pdf" else MAX_IMAGE_BYTES

    folder = resolve_under(NOTES_ROOT, str(note_id))
    folder.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{extension}"
    destination = folder / stored_name

    size = 0
    completed = False
    budget = quota.remaining(user)
    try:
        async with aiofiles.open(destination, "xb") as out:
            chunk = head
            while chunk:
                size += len(chunk)
                if size > limit:
                    raise HTTPException(status_code=413, detail=f"O arquivo passa de {limit // (1024 * 1024)} MB.")
                if budget is not None and size > budget:
                    raise HTTPException(status_code=413, detail="Isso não cabe no seu espaço restante neste servidor.")
                await out.write(chunk)
                chunk = await file.read(CHUNK_SIZE)
        completed = True
    finally:
        if not completed:  # envio interrompido, grande demais ou disco cheio: não deixa arquivo pela metade
            destination.unlink(missing_ok=True)

    attachment = Attachment(
        note_id=note_id,
        file_path=f"{note_id}/{stored_name}",
        file_type=kind,
        file_name=_display_name(file.filename, extension),
        content_type=content_type,
        size=size,
        created_at=datetime.now(timezone.utc),
    )
    try:
        db.add(attachment)
        note.updated_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    quota.add(user, size)
    return _out(attachment)


@router.get("/{attachment_id}/file")
def attachment_file(note_id: int, attachment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> FileResponse:
    """O arquivo. Exige o token de login (o app o busca com fetch e o mostra a partir da memória)."""
    attachment = _owned_attachment(db, user, note_id, attachment_id)
    path = resolve_under(NOTES_ROOT, attachment.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="O arquivo deste anexo não está mais no HD.")
    return FileResponse(
        path,
        media_type=attachment.content_type,
        filename=attachment.file_name,
        content_disposition_type="inline",
        headers={"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{attachment_id}", status_code=204)
def delete_attachment(note_id: int, attachment_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    attachment = _owned_attachment(db, user, note_id, attachment_id)
    resolve_under(NOTES_ROOT, attachment.file_path).unlink(missing_ok=True)
    db.delete(attachment)
    db.commit()
    quota.forget(user.id)
    return Response(status_code=204)
