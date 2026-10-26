import logging
import re
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .errors import install_error_handling
from .auth import get_current_user, require_admin
from .database import engine, init_db
from .routers import (
    admin_routes,
    agenda_routes,
    auth_routes,
    finance_routes,
    planning_routes,
    profile_routes,
    github_routes,
    note_attachments_routes,
    notes_routes,
    projects_routes,
    updates_routes,
    voice_routes,
)
from .config import MIGRATION_TOKEN
from .routers.updates_routes import ensure_updates_root
from .storage import ensure_data_root


class _HideStreamToken(logging.Filter):
    """O token de login vai na URL do /stream (?token=...): o log de acessos não deve gravá-lo."""

    _PATTERN = re.compile(r"([?&]token=)[^&\s\"]+")

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3:
            args = list(record.args)
            args[2] = self._PATTERN.sub(r"\1***", str(args[2]))
            record.args = tuple(args)
        return True


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.getLogger("uvicorn.access").addFilter(_HideStreamToken())
    ensure_data_root()
    ensure_updates_root()
    init_db()
    yield
    engine.dispose()  # fecha o database.db de forma limpa (importante para um HD que será desconectado)


app = FastAPI(title="Lokos de S.I", version="0.7.0", lifespan=lifespan)

# Só o app Electron pode chamar a API a partir de uma tela: em desenvolvimento ele roda em
# localhost:5173 e, empacotado, em app://renderer (ver frontend/src/main/main.ts).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "app://renderer"],
    allow_methods=["GET", "POST", "PUT", "DELETE"],  # PUT e DELETE: o Bloco de Notas
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-Request-ID"],
)

install_error_handling(app)

# Tudo exige login (token JWT no cabeçalho Authorization), exceto /health e /auth/* (precisam estar
# abertos para entrar).
protected = [Depends(get_current_user)]
# Só o dono do servidor: contas de convidados.
admin_only = [Depends(require_admin)]
app.include_router(notes_routes.router, dependencies=protected)
app.include_router(note_attachments_routes.router, dependencies=protected)
app.include_router(agenda_routes.router, dependencies=protected)
app.include_router(finance_routes.router, dependencies=protected)
app.include_router(planning_routes.router, dependencies=protected)
app.include_router(profile_routes.router, dependencies=protected)
app.include_router(projects_routes.router, dependencies=protected)
app.include_router(github_routes.router, dependencies=protected)
app.include_router(github_routes.settings_router, dependencies=protected)
app.include_router(auth_routes.router)
app.include_router(admin_routes.router, dependencies=admin_only)
# Sem "dependencies=protected": um WebSocket de navegador/Electron não manda cabeçalhos customizados
# (Authorization), então a rota confere o token sozinha, pela query string (?token=), como o /stream.
app.include_router(voice_routes.router)
# Sem login: é a primeira coisa que o app confere ao abrir (antes de a pessoa ter um token) — ver updates_routes.py.
app.include_router(updates_routes.router)
# Uso único, ao hospedar num servidor novo: só existe se MIGRATION_TOKEN estiver configurado (ver
# migrate_routes.py). A própria rota confere o token dela, sem precisar de um login já existente.
if MIGRATION_TOKEN:
    from .routers import migrate_routes

    app.include_router(migrate_routes.router)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
