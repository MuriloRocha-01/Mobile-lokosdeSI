import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from .. import github, secretbox
from ..auth import get_current_user
from ..database import get_db
from ..models import GithubCredential, User
from ..schemas import GithubBranches, GithubCommits, GithubPullRequests, GithubStats, GithubStatus, GithubTokenIn
from .projects_routes import get_owned_project

# Token: POST /settings/github (e GET/DELETE para ver a situação e remover).
settings_router = APIRouter(prefix="/settings/github", tags=["github"])
# Dados do repositório de um projeto: /projects/{id}/github/commits e /stats.
router = APIRouter(prefix="/projects/{project_id}/github", tags=["github"])

_TOKEN_PATTERN = re.compile(r"^[A-Za-z0-9_\-]{20,255}$")  # PAT clássico (ghp_...) e fine-grained (github_pat_...)


def _fail(exc: github.GithubError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=exc.detail)


def _saved_token(db: Session, user: User) -> str | None:
    """O token salvo (já descriptografado), ou None se não há. Lança erro se há um que não dá para ler."""
    credential = db.get(GithubCredential, user.id)
    if credential is None:
        return None
    token = secretbox.decrypt(credential.token_encrypted)
    if token is None:
        raise HTTPException(
            status_code=400,
            detail="O token do GitHub salvo não pôde ser lido neste computador (ele foi salvo em outro PC). Salve-o de novo em Conectar GitHub.",
        )
    return token


# ---------------------------------------------------------------- token


@settings_router.post("", response_model=GithubStatus)
async def save_token(payload: GithubTokenIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> GithubStatus:
    """Confere o token no GitHub e o guarda CRIPTOGRAFADO no banco. Ele nunca é devolvido pela API."""
    token = payload.token.strip()
    if not _TOKEN_PATTERN.match(token):
        raise HTTPException(status_code=400, detail="Isso não parece um token do GitHub (Personal Access Token).")
    try:
        login = await github.token_owner(token)  # confirma que o GitHub aceita este token
    except github.GithubError as exc:
        raise _fail(exc) from None

    credential = db.get(GithubCredential, user.id)
    encrypted = secretbox.encrypt(token)
    if credential is None:
        db.add(GithubCredential(user_id=user.id, token_encrypted=encrypted, login=login, updated_at=datetime.now(timezone.utc)))
    else:
        credential.token_encrypted, credential.login, credential.updated_at = encrypted, login, datetime.now(timezone.utc)
    db.commit()
    github.forget_user(user.id)
    return GithubStatus(configured=True, login=login)


@settings_router.get("", response_model=GithubStatus)
def token_status(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> GithubStatus:
    credential = db.get(GithubCredential, user.id)
    if credential is None:
        return GithubStatus(configured=False)
    readable = secretbox.decrypt(credential.token_encrypted) is not None
    return GithubStatus(configured=readable, login=credential.login or None, unreadable=not readable)


@settings_router.delete("", status_code=204)
def remove_token(user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    credential = db.get(GithubCredential, user.id)
    if credential is not None:
        db.delete(credential)
        db.commit()
    github.forget_user(user.id)
    return Response(status_code=204)


# ---------------------------------------------------------------- dados do repositório


@router.get("/commits", response_model=GithubCommits)
async def commits(
    project_id: int,
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GithubCommits:
    """Os 10 últimos commits do repositório do projeto (mensagem, data, autor e link)."""
    project = get_owned_project(db, user, project_id)
    token = _saved_token(db, user)
    try:
        owner, repo = github.parse_repository(project.repository_url)
        items = await github.get_commits(user.id, owner, repo, token, refresh)
    except github.GithubError as exc:
        raise _fail(exc) from None
    return GithubCommits(repository=f"{owner}/{repo}", commits=items)


@router.get("/branches", response_model=GithubBranches)
async def branches(
    project_id: int,
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GithubBranches:
    """Os branches do repositório do projeto (nome, commit e se é protegido)."""
    project = get_owned_project(db, user, project_id)
    token = _saved_token(db, user)
    try:
        owner, repo = github.parse_repository(project.repository_url)
        items = await github.get_branches(user.id, owner, repo, token, refresh)
    except github.GithubError as exc:
        raise _fail(exc) from None
    return GithubBranches(repository=f"{owner}/{repo}", branches=items)


@router.get("/pulls", response_model=GithubPullRequests)
async def pull_requests(
    project_id: int,
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GithubPullRequests:
    """Os pull requests do repositório do projeto (título, autor, situação e link)."""
    project = get_owned_project(db, user, project_id)
    token = _saved_token(db, user)
    try:
        owner, repo = github.parse_repository(project.repository_url)
        items = await github.get_pull_requests(user.id, owner, repo, token, refresh)
    except github.GithubError as exc:
        raise _fail(exc) from None
    return GithubPullRequests(repository=f"{owner}/{repo}", pull_requests=items)


@router.get("/stats", response_model=GithubStats)
async def stats(
    project_id: int,
    refresh: bool = False,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GithubStats:
    """Linguagem principal, estrelas, forks e issues abertas do repositório do projeto."""
    project = get_owned_project(db, user, project_id)
    token = _saved_token(db, user)
    try:
        owner, repo = github.parse_repository(project.repository_url)
        data = await github.get_stats(user.id, owner, repo, token, refresh)
    except github.GithubError as exc:
        raise _fail(exc) from None
    return GithubStats(**data)
