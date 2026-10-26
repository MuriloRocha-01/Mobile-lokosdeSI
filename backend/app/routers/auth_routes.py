import hashlib
import secrets
import time

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth, quota
from ..config import GUEST_QUOTA_BYTES
from ..database import get_db
from ..models import User, LoginSession
from ..schemas import LoginRequest, RegisterRequest, TokenResponse, UserPublic, RefreshRequest

router = APIRouter(prefix="/auth", tags=["autenticação"])

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
MAX_NAME_LENGTH = 100
MAX_EMAIL_LENGTH = 254


def _clean_email(raw: str) -> str:
    email = raw.strip().lower()
    if len(email) > MAX_EMAIL_LENGTH or not EMAIL_PATTERN.match(email):
        raise HTTPException(status_code=400, detail="Informe um e-mail válido.")
    return email


def _token_response(user: User, db: Session, refresh_token: str | None = None) -> TokenResponse:
    if refresh_token is None:
        refresh_token = secrets.token_urlsafe(48)
        db.add(LoginSession(token_hash=hashlib.sha256(refresh_token.encode()).hexdigest(),
            user_id=user.id, password_stamp=hashlib.sha256(user.password_hash.encode()).hexdigest(),
            expires_at=int(time.time()) + 180 * 86400))
        db.commit()
    token, expires_in = auth.create_access_token(user.id)
    return TokenResponse(refresh_token=refresh_token, access_token=token, expires_in=expires_in, user=UserPublic.model_validate(user))


@router.post("/register", status_code=201, response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Cria uma conta e já devolve um token (a pessoa entra logada).

    A primeira conta do servidor é a do dono (administrador); qualquer pessoa com o endereço do
    servidor pode criar as demais, cada uma no seu próprio espaço.
    """
    name = " ".join(payload.name.split())  # tira espaços das pontas e repetidos
    if not name or len(name) > MAX_NAME_LENGTH:
        raise HTTPException(status_code=400, detail=f"Informe um nome de até {MAX_NAME_LENGTH} caracteres.")
    email = _clean_email(payload.email)
    try:
        auth.validate_password(payload.password)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    first_account = (db.scalar(select(func.count()).select_from(User)) or 0) == 0

    if db.scalar(select(User.id).where(User.email == email)) is not None:
        raise HTTPException(status_code=409, detail="Este e-mail já está cadastrado.")

    user = User(name=name, email=email, password_hash=auth.hash_password(payload.password), is_admin=first_account)
    db.add(user)
    try:
        db.commit()
    except IntegrityError:  # duas contas com o mesmo e-mail criadas ao mesmo tempo
        db.rollback()
        raise HTTPException(status_code=409, detail="Este e-mail já está cadastrado.")

    return _token_response(user, db)


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    """Confere e-mail e senha e devolve um token JWT."""
    email = payload.email.strip().lower()
    try:
        auth.check_login_allowed(email)
    except auth.TooManyAttempts as exc:
        raise HTTPException(status_code=429, detail=str(exc), headers={"Retry-After": str(exc.retry_after)})

    user = db.scalar(select(User).where(User.email == email))
    # Sempre roda um bcrypt, exista ou não a conta: assim o tempo da resposta não revela
    # quais e-mails estão cadastrados. A mensagem também é a mesma nos dois casos.
    valid = auth.verify_password(payload.password, user.password_hash if user else auth.DUMMY_HASH)
    if user is None or not valid:
        auth.register_login_failure(email)
        raise HTTPException(status_code=401, detail="E-mail ou senha incorretos.")

    auth.clear_login_failures(email)
    if auth.pwd_context.needs_update(user.password_hash):  # ex: o custo do bcrypt foi aumentado
        user.password_hash = auth.hash_password(payload.password)
        db.commit()
    return _token_response(user, db)


@router.get("/usage")
def usage(user: User = Depends(auth.get_current_user)) -> dict:
    """Espaço usado no servidor e o limite da conta (limit = null para o dono, que não tem limite)."""
    return {"used": quota.used(user), "limit": None if user.is_admin else GUEST_QUOTA_BYTES}


@router.get("/me", response_model=UserPublic)
def me(user: User = Depends(auth.get_current_user)) -> User:
    """Quem está logado. Também serve para conferir se um token ainda vale."""
    return user


@router.post("/session", response_model=TokenResponse)
def start_session(user: User = Depends(auth.get_current_user), db: Session = Depends(get_db)):
    # Migra um login antigo ainda válido sem pedir a senha novamente.
    return _token_response(user, db)


@router.post("/refresh", response_model=TokenResponse)
def refresh(payload: RefreshRequest, db: Session = Depends(get_db)):
    session = db.get(LoginSession, hashlib.sha256(payload.refresh_token.encode()).hexdigest())
    user = db.get(User, session.user_id) if session else None
    if (not session or not user or session.expires_at <= int(time.time())
        or not secrets.compare_digest(session.password_stamp, hashlib.sha256(user.password_hash.encode()).hexdigest())):
        raise HTTPException(status_code=401, detail="Sessão encerrada. Entre novamente.")
    session.expires_at = int(time.time()) + 180 * 86400
    db.commit()
    return _token_response(user, db, payload.refresh_token)


@router.post("/logout", status_code=204)
def logout(payload: RefreshRequest, db: Session = Depends(get_db)):
    session = db.get(LoginSession, hashlib.sha256(payload.refresh_token.encode()).hexdigest())
    if session:
        db.delete(session)
        db.commit()
