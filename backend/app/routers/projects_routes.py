import re
import shutil
import uuid
from datetime import date, datetime, timezone
from pathlib import Path

import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import quota
from ..auth import get_current_user
from ..config import PROJECTS_ROOT
from ..database import get_db
from ..models import Project, ProjectImage, ProjectLog, User
from ..schemas import (
    ImageOut,
    LogCreate,
    LogOut,
    ProjectCreate,
    ProjectOut,
    ProjectSummary,
    ProjectUpdate,
)
from ..storage import resolve_under

router = APIRouter(prefix="/projects", tags=["projetos"])

MAX_NAME_LENGTH = 120
MAX_REPOSITORY_LENGTH = 300
MAX_CONTENT_LENGTH = 1_000_000  # caracteres de documentação por projeto
MAX_LOG_LENGTH = 1000
MAX_IMAGE_BYTES = 10 * 1024 * 1024
MAX_IMAGES_PER_PROJECT = 100
CHUNK_SIZE = 1024 * 1024

# Formatos aceitos, reconhecidos pelo CONTEÚDO do arquivo (o nome/tipo enviado pode mentir).
# SVG fica de fora de propósito: pode carregar scripts.
_IMAGE_TYPES = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"GIF87a", "image/gif", ".gif"),
    (b"GIF89a", "image/gif", ".gif"),
)


def _detect_image(head: bytes) -> tuple[str, str] | None:
    for magic, content_type, extension in _IMAGE_TYPES:
        if head.startswith(magic):
            return content_type, extension
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


def _now() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- validação


def _clean_name(name: str) -> str:
    name = " ".join(name.split())
    if not name:
        raise HTTPException(status_code=400, detail="Dê um nome ao projeto.")
    if len(name) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"O nome pode ter até {MAX_NAME_LENGTH} caracteres.")
    return name


def _clean_repository(value: str) -> str:
    value = value.strip()
    if len(value) > MAX_REPOSITORY_LENGTH:
        raise HTTPException(status_code=400, detail="O endereço do repositório é longo demais.")
    if re.search(r"[\s\x00-\x1f]", value):
        raise HTTPException(status_code=400, detail="O endereço do repositório não pode ter espaços.")
    return value


def _clean_content(content: str) -> str:
    if len(content) > MAX_CONTENT_LENGTH:
        raise HTTPException(status_code=413, detail="A documentação é grande demais (máximo de 1 milhão de caracteres).")
    return content


def get_owned_project(db: Session, user: User, project_id: int) -> Project:
    """O projeto, se existir E for desta conta; senão 404 (não revela que existe)."""
    project = db.scalar(select(Project).where(Project.id == project_id, Project.user_id == user.id))
    if project is None:
        raise HTTPException(status_code=404, detail="Projeto não encontrado.")
    return project


def _project_folder(project_id: int) -> Path:
    return resolve_under(PROJECTS_ROOT, str(project_id))


def _counts(db: Session, project_ids: list[int]) -> tuple[dict[int, int], dict[int, int]]:
    logs = dict(
        db.execute(
            select(ProjectLog.project_id, func.count()).where(ProjectLog.project_id.in_(project_ids)).group_by(ProjectLog.project_id)
        ).all()
    )
    images = dict(
        db.execute(
            select(ProjectImage.project_id, func.count())
            .where(ProjectImage.project_id.in_(project_ids))
            .group_by(ProjectImage.project_id)
        ).all()
    )
    return logs, images


def _as_out(db: Session, project: Project) -> ProjectOut:
    logs, images = _counts(db, [project.id])
    out = ProjectOut.model_validate(project)
    out.log_count, out.image_count = logs.get(project.id, 0), images.get(project.id, 0)
    return out


# ---------------------------------------------------------------- projetos


@router.get("", response_model=list[ProjectSummary])
def list_projects(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ProjectSummary]:
    """Seus projetos, do alterado mais recentemente para o mais antigo (sem a documentação)."""
    projects = list(
        db.scalars(select(Project).where(Project.user_id == user.id).order_by(Project.updated_at.desc(), Project.id.desc()))
    )
    logs, images = _counts(db, [p.id for p in projects])
    result = []
    for project in projects:
        item = ProjectSummary.model_validate(project)
        item.log_count, item.image_count = logs.get(project.id, 0), images.get(project.id, 0)
        result.append(item)
    return result


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(payload: ProjectCreate, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ProjectOut:
    project = Project(
        user_id=user.id,
        name=_clean_name(payload.name),
        status=payload.status,
        repository_url=_clean_repository(payload.repository_url),
        content=_clean_content(payload.content),
        created_at=_now(),
        updated_at=_now(),
    )
    db.add(project)
    db.commit()
    return _as_out(db, project)


@router.get("/{project_id}", response_model=ProjectOut)
def read_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> ProjectOut:
    return _as_out(db, get_owned_project(db, user, project_id))


@router.put("/{project_id}", response_model=ProjectOut)
def update_project(
    project_id: int,
    payload: ProjectUpdate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectOut:
    """Atualiza nome, situação, repositório e/ou documentação. O que não for enviado continua igual."""
    project = get_owned_project(db, user, project_id)
    if payload.name is not None:
        project.name = _clean_name(payload.name)
    if payload.status is not None:
        project.status = payload.status
    if payload.repository_url is not None:
        project.repository_url = _clean_repository(payload.repository_url)
    if payload.content is not None:
        project.content = _clean_content(payload.content)
    project.updated_at = _now()
    db.commit()
    return _as_out(db, project)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    """Exclui o projeto, o changelog e as imagens (inclusive os arquivos no HD). Não dá para desfazer."""
    project = get_owned_project(db, user, project_id)
    db.delete(project)  # o banco apaga logs e imagens em cascata (ON DELETE CASCADE)
    db.commit()
    shutil.rmtree(_project_folder(project_id), ignore_errors=True)
    return Response(status_code=204)


# ---------------------------------------------------------------- changelog manual


@router.get("/{project_id}/logs", response_model=list[LogOut])
def list_logs(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ProjectLog]:
    """Registros do changelog, do dia mais recente para o mais antigo."""
    get_owned_project(db, user, project_id)
    query = select(ProjectLog).where(ProjectLog.project_id == project_id).order_by(ProjectLog.date.desc(), ProjectLog.id.desc())
    return list(db.scalars(query))


@router.post("/{project_id}/logs", response_model=LogOut, status_code=201)
def add_log(
    project_id: int,
    payload: LogCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ProjectLog:
    project = get_owned_project(db, user, project_id)
    description = " ".join(payload.description.split())
    if not description:
        raise HTTPException(status_code=400, detail="Escreva o que foi feito.")
    if len(description) > MAX_LOG_LENGTH:
        raise HTTPException(status_code=400, detail=f"O registro pode ter até {MAX_LOG_LENGTH} caracteres.")
    log = ProjectLog(project_id=project_id, date=payload.date or date.today(), description=description, created_at=_now())
    db.add(log)
    project.updated_at = _now()
    db.commit()
    return log


@router.delete("/{project_id}/logs/{log_id}", status_code=204)
def delete_log(project_id: int, log_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    project = get_owned_project(db, user, project_id)
    log = db.scalar(select(ProjectLog).where(ProjectLog.id == log_id, ProjectLog.project_id == project_id))
    if log is None:
        raise HTTPException(status_code=404, detail="Registro não encontrado.")
    db.delete(log)
    project.updated_at = _now()
    db.commit()
    return Response(status_code=204)


# ---------------------------------------------------------------- imagens (prints das telas)


def _image_url(image: ProjectImage) -> str:
    return f"/projects/{image.project_id}/images/{image.id}/file"


def _image_out(image: ProjectImage) -> ImageOut:
    # o nome vira o texto alternativo; colchetes quebrariam a sintaxe do Markdown
    alt = re.sub(r"[\[\]()]", "", Path(image.original_name).stem) or "imagem"
    url = _image_url(image)
    return ImageOut(
        id=image.id,
        name=image.original_name,
        content_type=image.content_type,
        size=image.size,
        created_at=image.created_at,
        url=url,
        markdown=f"![{alt}]({url})",
    )


def _display_name(filename: str | None, extension: str) -> str:
    name = (filename or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f]", "", name).strip()[:200]
    return name or f"imagem{extension}"


@router.get("/{project_id}/images", response_model=list[ImageOut])
def list_images(project_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> list[ImageOut]:
    """As imagens do projeto, da mais antiga para a mais nova (a ordem em que foram enviadas)."""
    get_owned_project(db, user, project_id)
    query = select(ProjectImage).where(ProjectImage.project_id == project_id).order_by(ProjectImage.id)
    return [_image_out(image) for image in db.scalars(query)]


@router.post("/{project_id}/images", response_model=ImageOut, status_code=201)
async def upload_image(
    project_id: int,
    file: UploadFile = File(...),
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ImageOut:
    """Recebe um print (PNG, JPEG, GIF ou WebP até 10 MB), grava no HD e devolve a URL local dele."""
    project = get_owned_project(db, user, project_id)
    total = db.scalar(select(func.count()).select_from(ProjectImage).where(ProjectImage.project_id == project_id)) or 0
    if total >= MAX_IMAGES_PER_PROJECT:
        raise HTTPException(status_code=400, detail=f"Cada projeto aceita até {MAX_IMAGES_PER_PROJECT} imagens.")

    head = await file.read(CHUNK_SIZE)
    detected = _detect_image(head)
    if detected is None:
        raise HTTPException(status_code=400, detail="Formato não aceito. Envie uma imagem PNG, JPEG, GIF ou WebP.")
    content_type, extension = detected

    folder = _project_folder(project_id)
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
                if size > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="A imagem passa de 10 MB.")
                if budget is not None and size > budget:
                    raise HTTPException(status_code=413, detail="Isso não cabe no seu espaço restante neste servidor.")
                await out.write(chunk)
                chunk = await file.read(CHUNK_SIZE)
        completed = True
    finally:
        if not completed:  # envio interrompido, grande demais ou disco cheio: não deixa arquivo pela metade
            destination.unlink(missing_ok=True)

    image = ProjectImage(
        project_id=project_id,
        stored_name=stored_name,
        original_name=_display_name(file.filename, extension),
        content_type=content_type,
        size=size,
        created_at=_now(),
    )
    try:
        db.add(image)
        project.updated_at = _now()
        db.commit()
    except Exception:
        db.rollback()
        destination.unlink(missing_ok=True)
        raise
    quota.add(user, size)
    return _image_out(image)


def _owned_image(db: Session, user: User, project_id: int, image_id: int) -> tuple[Project, ProjectImage]:
    project = get_owned_project(db, user, project_id)
    image = db.scalar(select(ProjectImage).where(ProjectImage.id == image_id, ProjectImage.project_id == project_id))
    if image is None:
        raise HTTPException(status_code=404, detail="Imagem não encontrada.")
    return project, image


@router.get("/{project_id}/images/{image_id}/file")
def image_file(project_id: int, image_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> FileResponse:
    """O arquivo da imagem. Exige o token de login (por isso o app o busca com fetch e não com <img src>)."""
    _, image = _owned_image(db, user, project_id, image_id)
    path = _project_folder(project_id) / image.stored_name
    if not path.is_file():
        raise HTTPException(status_code=404, detail="O arquivo desta imagem não está mais no HD.")
    return FileResponse(
        path,
        media_type=image.content_type,
        # no-cache: o navegador pode guardar a imagem, mas precisa perguntar ao servidor (com o login) antes
        # de reutilizá-la. Com max-age ele mostraria a cópia guardada até para quem não está logado.
        headers={"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/{project_id}/images/{image_id}", status_code=204)
def delete_image(project_id: int, image_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    project, image = _owned_image(db, user, project_id, image_id)
    (_project_folder(project_id) / image.stored_name).unlink(missing_ok=True)
    db.delete(image)
    project.updated_at = _now()
    db.commit()
    quota.forget(user.id)
    return Response(status_code=204)
