"""Espaço usado por cada convidado: anexos das notas e imagens dos projetos dele.

O dono do servidor não tem limite. A soma é guardada por alguns segundos (percorrer milhares de
arquivos a cada envio seria lento) e corrigida a cada gravação; apagar ou baixar coisas por fora
chama forget() para recontar.
"""

import threading
import time

from fastapi import HTTPException

from sqlalchemy import func, select

from .config import GUEST_QUOTA_BYTES
from .database import SessionLocal
from .models import Attachment, Note, Project, ProjectImage, User
from .storage import folder_size, guest_base

_TTL_SECONDS = 30
_lock = threading.Lock()
_cache: dict[int, list] = {}  # id da conta -> [bytes usados, quando foi contado]


def used(user: User) -> int:
    now = time.monotonic()
    with _lock:
        entry = _cache.get(user.id)
        if entry and now - entry[1] < _TTL_SECONDS:
            return entry[0]
    total = folder_size(guest_base(user.id))  # fora do lock: pode demorar
    with SessionLocal() as db:  # as imagens dos projetos ficam em outra pasta, mas são do convidado
        total += db.scalar(select(func.coalesce(func.sum(ProjectImage.size), 0)).join(Project, Project.id == ProjectImage.project_id).where(Project.user_id == user.id)) or 0
        total += db.scalar(select(func.coalesce(func.sum(Attachment.size), 0)).join(Note, Note.id == Attachment.note_id).where(Note.user_id == user.id)) or 0
    with _lock:
        _cache[user.id] = [total, now]
    return total


def remaining(user: User) -> int | None:
    """Bytes que ainda cabem, ou None se a conta não tem limite (o dono)."""
    if user.is_admin:
        return None
    return max(0, GUEST_QUOTA_BYTES - used(user))


def add(user: User, size: int) -> None:
    """Soma o que acabou de ser gravado ao valor guardado."""
    with _lock:
        entry = _cache.get(user.id)
        if entry:
            entry[0] += size


def forget(user_id: int) -> None:
    with _lock:
        _cache.pop(user_id, None)


def ensure_room(user: User, size: int) -> None:
    """413 se 'size' bytes não cabem no que sobrou do espaço do convidado."""
    room = remaining(user)
    if room is not None and size > room:
        if room == 0:
            raise HTTPException(status_code=413, detail="O seu espaço neste servidor está cheio. Apague algo para continuar.")
        raise HTTPException(status_code=413, detail="Isso não cabe no seu espaço restante neste servidor.")
