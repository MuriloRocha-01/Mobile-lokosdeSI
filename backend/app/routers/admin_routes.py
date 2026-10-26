"""Só o dono do servidor: as contas dos convidados."""

import shutil

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth, quota
from ..config import GUEST_QUOTA_BYTES, NOTES_ROOT, PROJECTS_ROOT
from ..database import get_db
from ..models import Note, Project, User
from ..schemas import GuestOut
from ..storage import guest_base, resolve_under

router = APIRouter(prefix="/admin", tags=["convidados"])


# ---------------------------------------------------------------- contas


@router.get("/users", response_model=list[GuestOut])
def list_users(db: Session = Depends(get_db)) -> list[GuestOut]:
    """Todas as contas do servidor, com o espaço usado por cada convidado."""
    result = []
    for user in db.scalars(select(User).order_by(User.id)):
        folder = guest_base(user.id)
        result.append(
            GuestOut(
                id=user.id,
                name=user.name,
                email=user.email,
                is_admin=user.is_admin,
                created_at=user.created_at,
                storage_bytes=None if user.is_admin else quota.used(user),
                storage_limit=None if user.is_admin else GUEST_QUOTA_BYTES,
                folder=None if user.is_admin else str(folder),
            )
        )
    return result


@router.delete("/users/{user_id}", status_code=204)
def remove_user(user_id: int, admin: User = Depends(auth.require_admin), db: Session = Depends(get_db)) -> Response:
    """Remove o acesso de um convidado: a conta, as notas, os projetos e o token do GitHub dele.

    Os ARQUIVOS dele (Convidados/<id>) ficam no HD; você decide o que fazer com eles.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Conta não encontrada.")
    if user.is_admin:
        raise HTTPException(status_code=400, detail="A conta do dono do servidor não pode ser removida.")
    if user.id == admin.id:
        raise HTTPException(status_code=400, detail="Você não pode remover a si mesmo.")

    project_ids = list(db.scalars(select(Project.id).where(Project.user_id == user.id)))
    note_ids = list(db.scalars(select(Note.id).where(Note.user_id == user.id)))
    db.delete(user)  # o banco apaga notas, projetos, registros, imagens e convites em cascata
    db.commit()
    for project_id in project_ids:  # as imagens dos projetos são arquivos: saem junto
        shutil.rmtree(resolve_under(PROJECTS_ROOT, str(project_id)), ignore_errors=True)
    for note_id in note_ids:  # e os anexos (fotos e PDFs) das notas
        shutil.rmtree(resolve_under(NOTES_ROOT, str(note_id)), ignore_errors=True)
    return Response(status_code=204)
