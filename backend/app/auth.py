"""Senhas (passlib + bcrypt), tokens JWT e a dependência que identifica o usuário logado."""

import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET_FILE
from .database import get_db
from .models import User

# ------------------------------------------------------------------ senhas

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # limite do bcrypt: o que passa disso seria ignorado em silêncio

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")  # bcrypt, custo 12 por padrão

# Hash de uma senha qualquer: serve para gastar o mesmo tempo quando o e-mail não existe.
DUMMY_HASH = pwd_context.hash(secrets.token_urlsafe(16))


def validate_password(password: str) -> None:
    """Levanta ValueError (mensagem em português) se a senha não puder ser usada."""
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"A senha deve ter pelo menos {MIN_PASSWORD_LENGTH} caracteres.")
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise ValueError(f"A senha é longa demais (máximo de {MAX_PASSWORD_BYTES} bytes, cerca de 70 letras).")
    if "\x00" in password:
        raise ValueError("A senha contém um caractere inválido.")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        validate_password(password)
    except ValueError:
        # Não deixa uma senha longa "casar" só pelos primeiros 72 bytes; gasta o mesmo tempo.
        pwd_context.verify("x", DUMMY_HASH)
        return False
    return pwd_context.verify(password, password_hash)


# ------------------------------------------------------------------ token JWT

_secret_lock = threading.Lock()
_secret: str | None = None


def _jwt_secret() -> str:
    """Segredo que assina os tokens: gerado ao acaso na 1ª execução, único por instalação."""
    global _secret
    with _secret_lock:
        if _secret is None:
            configured = os.environ.get("JWT_SECRET")
            if configured:
                _secret = configured
            else:
                try:
                    _secret = JWT_SECRET_FILE.read_text(encoding="utf-8").strip()
                except FileNotFoundError:
                    _secret = ""
                if len(_secret) < 32:
                    _secret = secrets.token_urlsafe(48)
                    JWT_SECRET_FILE.parent.mkdir(parents=True, exist_ok=True)
                    tmp = JWT_SECRET_FILE.with_name(JWT_SECRET_FILE.name + ".tmp")
                    tmp.write_text(_secret, encoding="utf-8")
                    os.replace(tmp, JWT_SECRET_FILE)
        return _secret


def create_access_token(user_id: int) -> tuple[str, int]:
    """Devolve (token, segundos de validade)."""
    now = datetime.now(timezone.utc)
    lifetime = timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "iat": now, "exp": now + lifetime}
    token = jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)
    return token, int(lifetime.total_seconds())


def decode_access_token(token: str) -> int | None:
    """Id do usuário do token, ou None se ele for inválido, adulterado ou estiver expirado."""
    try:
        payload = jwt.decode(
            token,
            _jwt_secret(),
            algorithms=[JWT_ALGORITHM],  # lista fixa: recusa tokens "alg: none" e outros algoritmos
            options={"require": ["exp", "sub"]},
        )
        return int(payload["sub"])
    except (jwt.PyJWTError, ValueError, KeyError):
        return None


# ------------------------------------------------------------------ freio no login

MAX_LOGIN_FAILURES = 5
LOGIN_LOCKOUT_SECONDS = 30
_login_lock = threading.Lock()
_login_state: dict[str, list[float]] = {}  # e-mail -> [falhas seguidas, bloqueado até, última falha]


class TooManyAttempts(Exception):
    def __init__(self, retry_after: int):
        super().__init__(f"Muitas tentativas erradas. Aguarde {retry_after} s e tente de novo.")
        self.retry_after = retry_after


def check_login_allowed(email: str) -> None:
    with _login_lock:
        state = _login_state.get(email)
        if state:
            remaining = state[1] - time.monotonic()
            if remaining > 0:
                raise TooManyAttempts(int(remaining) + 1)


def register_login_failure(email: str) -> None:
    now = time.monotonic()
    with _login_lock:
        if len(_login_state) > 1000:  # não deixa o dicionário crescer sem limite
            for key in [k for k, v in _login_state.items() if now - v[2] > 3600]:
                del _login_state[key]
        state = _login_state.setdefault(email, [0, 0.0, now])
        state[0] += 1
        state[2] = now
        if state[0] >= MAX_LOGIN_FAILURES:
            state[0] = 0
            state[1] = now + LOGIN_LOCKOUT_SECONDS


def clear_login_failures(email: str) -> None:
    with _login_lock:
        _login_state.pop(email, None)


# ------------------------------------------------------------------ usuário logado

_bearer = HTTPBearer(auto_error=False, description="Token recebido em /auth/login ou /auth/register")


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Dependência para proteger uma rota: `user: User = Depends(get_current_user)`."""
    headers = {"WWW-Authenticate": "Bearer"}
    if credentials is None:
        raise HTTPException(status_code=401, detail="Faça login para continuar.", headers=headers)
    user_id = decode_access_token(credentials.credentials)
    user = db.get(User, user_id) if user_id is not None else None
    if user is None:  # token ruim, expirado, ou a conta foi apagada depois de emitido
        raise HTTPException(status_code=401, detail="Sessão inválida ou expirada. Entre novamente.", headers=headers)
    return user


NOT_ADMIN = "Só o dono do servidor pode fazer isso."


def require_admin(user: User = Depends(get_current_user)) -> User:
    """Rotas do dono do servidor (contas de convidados): convidados recebem 403."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail=NOT_ADMIN)
    return user


