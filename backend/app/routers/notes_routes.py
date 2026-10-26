import re
import shutil
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import quota
from ..auth import get_current_user
from ..config import NOTES_ROOT
from ..database import get_db
from ..models import AgendaItem, Note, User
from ..schemas import NoteCreate, NoteOut, NoteUpdate
from ..storage import resolve_under

router = APIRouter(prefix="/notes", tags=["notas"])

MAX_TITLE_LENGTH = 200
MAX_CONTENT_LENGTH = 1_000_000  # caracteres por nota
MAX_TAGS = 20
MAX_TAG_LENGTH = 40
MAX_AGENDA_LINKS = 50  # itens da agenda ligados a uma mesma nota

# Um anexo que saiu do texto da nota só é apagado depois deste tempo (dá margem para desfazer com Ctrl+Z).
UNUSED_ATTACHMENT_GRACE = timedelta(minutes=10)
_ATTACHMENT_REF = re.compile(r"/notes/(\d+)/attachments/(\d+)/file")


def _clean_title(title: str) -> str:
    title = " ".join(title.split())  # sem quebras de linha nem espaços repetidos
    if len(title) > MAX_TITLE_LENGTH:
        raise HTTPException(status_code=400, detail=f"O título pode ter até {MAX_TITLE_LENGTH} caracteres.")
    return title


def _clean_content(content: str) -> str:
    if len(content) > MAX_CONTENT_LENGTH:
        raise HTTPException(status_code=413, detail="A nota é grande demais (máximo de 1 milhão de caracteres).")
    return content


def _clean_tags(tags: list[str]) -> str:
    """Minúsculas, sem '#', sem repetidas; devolve o texto que vai para o banco ("a,b")."""
    result: list[str] = []
    for raw in tags:
        for piece in raw.split(","):  # a vírgula é o separador no banco: "a,b" são duas tags
            tag = " ".join(piece.lstrip().lstrip("#").split()).lower()
            if not tag:
                continue
            if len(tag) > MAX_TAG_LENGTH:
                raise HTTPException(status_code=400, detail=f"Cada tag pode ter até {MAX_TAG_LENGTH} caracteres.")
            if tag not in result:
                result.append(tag)
    if len(result) > MAX_TAGS:
        raise HTTPException(status_code=400, detail=f"Use no máximo {MAX_TAGS} tags por nota.")
    return ",".join(result)


def _agenda_items(db: Session, user: User, ids: list[int]) -> list[AgendaItem]:
    """Os itens da agenda para ligar a uma nota. Só valem os SEUS: um id de outra conta é como se não existisse."""
    ids = list(dict.fromkeys(ids))  # sem repetidos, na ordem recebida
    if len(ids) > MAX_AGENDA_LINKS:
        raise HTTPException(status_code=400, detail=f"Uma nota pode ter até {MAX_AGENDA_LINKS} itens da agenda ligados.")
    if not ids:
        return []
    items = list(db.scalars(select(AgendaItem).where(AgendaItem.id.in_(ids), AgendaItem.user_id == user.id)))
    if len(items) != len(ids):
        raise HTTPException(status_code=404, detail="Um dos itens da agenda não foi encontrado.")
    return items


def _get_owned(db: Session, user: User, note_id: int) -> Note:
    """A nota, se existir E for deste usuário; para qualquer outro caso, 404 (não revela que existe)."""
    note = db.scalar(select(Note).where(Note.id == note_id, Note.user_id == user.id))
    if note is None:
        raise HTTPException(status_code=404, detail="Nota não encontrada.")
    return note


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value


def _drop_unused_attachments(note: Note, db: Session, user: User) -> None:
    """Apaga os anexos que a nota não usa mais (foram tirados do texto), com uma margem para desfazer."""
    used = {int(attachment) for note_id, attachment in _ATTACHMENT_REF.findall(note.content) if int(note_id) == note.id}
    cutoff = datetime.now(timezone.utc) - UNUSED_ATTACHMENT_GRACE
    removed = False
    for attachment in list(note.attachments):
        if attachment.id not in used and _aware(attachment.created_at) < cutoff:
            (NOTES_ROOT / attachment.file_path).unlink(missing_ok=True)
            db.delete(attachment)
            removed = True
    if removed:
        quota.forget(user.id)


@router.get("", response_model=list[NoteOut])
def list_notes(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[Note]:
    """Todas as suas notas, da mais recente para a mais antiga (já com os itens da agenda ligados)."""
    query = select(Note).where(Note.user_id == user.id).order_by(Note.updated_at.desc(), Note.id.desc())
    return list(db.scalars(query))


@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteCreate | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    """Cria uma nota. Sem corpo, ela nasce em branco."""
    payload = payload or NoteCreate()
    now = datetime.now(timezone.utc)
    note = Note(
        user_id=user.id,
        title=_clean_title(payload.title),
        content=_clean_content(payload.content),
        tags=_clean_tags(payload.tags),
        updated_at=now,
        created_at=now,
        agenda_items=_agenda_items(db, user, payload.agenda_ids),
    )
    db.add(note)
    db.commit()
    return note


@router.put("/{note_id}", response_model=NoteOut)
def update_note(
    note_id: int,
    payload: NoteUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Note:
    """Atualiza título, conteúdo, tags e/ou itens da agenda. O que não for enviado continua como está."""
    note = _get_owned(db, user, note_id)
    if payload.title is not None:
        note.title = _clean_title(payload.title)
    if payload.content is not None:
        note.content = _clean_content(payload.content)
        _drop_unused_attachments(note, db, user)
    if payload.tags is not None:
        note.tags = _clean_tags(payload.tags)
    if payload.agenda_ids is not None:
        note.agenda_items = _agenda_items(db, user, payload.agenda_ids)
    note.updated_at = datetime.now(timezone.utc)
    db.commit()
    return note


@router.delete("/{note_id}", status_code=204)
def delete_note(
    note_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    """Exclui a nota, os vínculos com a agenda e os anexos (inclusive os arquivos no HD)."""
    note = _get_owned(db, user, note_id)
    db.delete(note)  # o banco apaga vínculos e anexos em cascata (ON DELETE CASCADE)
    db.commit()
    shutil.rmtree(resolve_under(NOTES_ROOT, str(note_id)), ignore_errors=True)
    quota.forget(user.id)
    return Response(status_code=204)
