"""Cliente da API REST do GitHub (httpx assíncrono): commits, branches, pull requests e estatísticas de um repositório."""

import asyncio
import re
import ssl
import threading
import time
from datetime import datetime

import httpx

from .config import GITHUB_API_URL

API_VERSION = "2022-11-28"
TIMEOUT_SECONDS = 15
USER_AGENT = "EcossistemaMurilo/1.0 (+hub de projetos)"
COMMITS_LIMIT = 10
BRANCHES_LIMIT = 30
PULLS_LIMIT = 15
CACHE_SECONDS = 60  # o GitHub limita a 60 requisições/hora sem token: não repete a mesma pergunta à toa


class GithubError(Exception):
    """Erro já traduzido para o usuário. O status é o que a NOSSA API devolve (nunca 401: o app o
    entenderia como "sessão expirada" e deslogaria)."""

    def __init__(self, status_code: int, detail: str) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


# ---------------------------------------------------------------- endereço do repositório

_OWNER = r"[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})"
_REPO = r"[A-Za-z0-9._-]{1,100}"
_FULL_URL = re.compile(
    rf"^(?:(?:https?://)?(?:www\.)?github\.com/|git@github\.com:|ssh://git@github\.com/)({_OWNER})/({_REPO})",
    re.IGNORECASE,
)
_SHORT = re.compile(rf"^({_OWNER})/({_REPO})$")


def parse_repository(value: str) -> tuple[str, str]:
    """"dono/nome" ou uma URL do GitHub (https, ssh, com .git ou /tree/main) -> ("dono", "nome").

    O resultado vai direto para o caminho da API, então só letras, números, "-", "_" e "." passam.
    """
    text = value.strip()
    if not text:
        raise GithubError(400, "Este projeto ainda não tem o repositório do GitHub. Edite o projeto e preencha (ex: murilo/meu-app).")
    match = _FULL_URL.match(text) or _SHORT.match(text)
    if not match:
        raise GithubError(400, "Não entendi o endereço do repositório. Use o formato dono/nome (ex: murilo/meu-app) ou a URL do GitHub.")
    owner, repo = match.group(1), match.group(2)
    repo = repo.removesuffix(".git")
    if repo in ("", ".", ".."):
        raise GithubError(400, "Nome de repositório inválido.")
    return owner, repo


# ---------------------------------------------------------------- rede

_ssl_context: ssl.SSLContext | bool | None = None


def _verify():
    """Confia nos certificados do próprio Windows (como o resto do app; ver discover.py)."""
    global _ssl_context
    if _ssl_context is None:
        try:
            import truststore

            _ssl_context = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        except ImportError:
            _ssl_context = True
    return _ssl_context


def _reset_message(response: httpx.Response) -> str:
    try:
        when = datetime.fromtimestamp(int(response.headers["x-ratelimit-reset"])).strftime("%H:%M")
        return f" Tente de novo às {when}."
    except (KeyError, ValueError, OSError):
        return ""


def _translate(response: httpx.Response, authenticated: bool) -> GithubError:
    status = response.status_code
    try:
        message = str(response.json().get("message", ""))
    except ValueError:
        message = ""
    if status == 401:
        return GithubError(400, "O GitHub recusou o token salvo (inválido, expirado ou revogado). Salve um novo em Conectar GitHub.")
    if status == 404:
        if authenticated:
            return GithubError(404, "Repositório não encontrado, ou o token salvo não tem acesso a ele.")
        return GithubError(404, "Repositório não encontrado. Se ele for privado, salve um token do GitHub em Conectar GitHub.")
    if status in (403, 429) and (
        response.headers.get("x-ratelimit-remaining") == "0" or "rate limit" in message.lower() or status == 429
    ):
        extra = "" if authenticated else " Salvar um token do GitHub aumenta o limite."
        return GithubError(429, f"Limite de requisições do GitHub atingido.{_reset_message(response)}{extra}")
    if status == 403:
        return GithubError(403, f"O GitHub negou o acesso a este repositório. {message}".strip())
    if status == 409:  # "Git Repository is empty."
        return GithubError(409, "O repositório ainda está vazio.")
    return GithubError(502, f"O GitHub respondeu com erro {status}. Tente de novo em instantes.")


async def _get(path: str, token: str | None, params: dict | None = None) -> httpx.Response:
    headers = {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
    }
    if token:
        headers["Authorization"] = f"Bearer {token}"
    try:
        # Redirecionamentos: o GitHub responde 301 para repositórios renomeados. O httpx remove o
        # cabeçalho Authorization se o destino for outro site, então o token não vaza.
        async with httpx.AsyncClient(
            base_url=GITHUB_API_URL,
            timeout=TIMEOUT_SECONDS,
            verify=_verify(),
            follow_redirects=True,
            max_redirects=3,
        ) as client:
            response = await client.get(path, params=params, headers=headers)
    except httpx.TimeoutException:
        raise GithubError(502, "O GitHub demorou demais para responder. Tente de novo.") from None
    except httpx.HTTPError:
        raise GithubError(502, "Não foi possível conectar ao GitHub. Confira a sua conexão com a internet.") from None
    if response.status_code >= 400:
        raise _translate(response, authenticated=token is not None)
    return response


# ---------------------------------------------------------------- cache curto

_cache: dict[tuple, tuple[float, object]] = {}
_cache_lock = threading.Lock()


def _cached(key: tuple, refresh: bool):
    if refresh:
        return None
    with _cache_lock:
        hit = _cache.get(key)
        if hit and hit[0] > time.monotonic():
            return hit[1]
    return None


def _store(key: tuple, value: object) -> None:
    with _cache_lock:
        _cache[key] = (time.monotonic() + CACHE_SECONDS, value)


def forget_user(user_id: int) -> None:
    """Esquece as respostas guardadas de uma conta (ao trocar ou apagar o token)."""
    with _cache_lock:
        for key in [k for k in _cache if k[0] == user_id]:
            del _cache[key]


# ---------------------------------------------------------------- consultas


async def token_owner(token: str) -> str:
    """Confere o token no GitHub e devolve o usuário dono dele (GET /user)."""
    try:
        response = await _get("/user", token)
    except GithubError as exc:
        if exc.status_code in (400, 404):  # 401 do GitHub (traduzido para 400) ou 404 estranho
            raise GithubError(400, "O GitHub recusou esse token. Confira se ele foi copiado por inteiro e se não expirou.") from None
        raise
    return str(response.json().get("login", ""))


async def get_commits(user_id: int, owner: str, repo: str, token: str | None, refresh: bool = False) -> list[dict]:
    key = (user_id, "commits", owner.lower(), repo.lower())
    if (hit := _cached(key, refresh)) is not None:
        return hit  # type: ignore[return-value]
    try:
        response = await _get(f"/repos/{owner}/{repo}/commits", token, {"per_page": COMMITS_LIMIT})
        items = response.json()[:COMMITS_LIMIT]
    except GithubError as exc:
        if exc.status_code != 409:
            raise
        items = []  # repositório recém-criado, ainda sem nenhum commit
    commits = []
    for item in items:
        commit = item.get("commit") or {}
        author = commit.get("author") or {}
        sha = str(item.get("sha", ""))
        message = str(commit.get("message", "")).strip().splitlines()
        commits.append(
            {
                "sha": sha,
                "short_sha": sha[:7],
                "message": (message[0] if message else "(sem mensagem)")[:300],
                "date": str(author.get("date", "")),
                "author": author.get("name") or ((item.get("author") or {}).get("login")) or "desconhecido",
                "url": str(item.get("html_url", "")),
            }
        )
    _store(key, commits)
    return commits


async def get_branches(user_id: int, owner: str, repo: str, token: str | None, refresh: bool = False) -> list[dict]:
    key = (user_id, "branches", owner.lower(), repo.lower())
    if (hit := _cached(key, refresh)) is not None:
        return hit  # type: ignore[return-value]
    try:
        response = await _get(f"/repos/{owner}/{repo}/branches", token, {"per_page": BRANCHES_LIMIT})
        items = response.json()
    except GithubError as exc:
        if exc.status_code != 409:
            raise
        items = []  # repositório recém-criado, ainda sem nenhum branch
    branches = [
        {
            "name": str(item.get("name", "")),
            "sha": str(((item.get("commit") or {}).get("sha", ""))),
            "protected": bool(item.get("protected", False)),
        }
        for item in items
    ]
    _store(key, branches)
    return branches


async def get_pull_requests(user_id: int, owner: str, repo: str, token: str | None, refresh: bool = False) -> list[dict]:
    key = (user_id, "pulls", owner.lower(), repo.lower())
    if (hit := _cached(key, refresh)) is not None:
        return hit  # type: ignore[return-value]
    response = await _get(f"/repos/{owner}/{repo}/pulls", token, {"state": "all", "per_page": PULLS_LIMIT})
    pulls = []
    for item in response.json():
        merged_at = item.get("merged_at")
        state = "merged" if merged_at else str(item.get("state", "open"))
        pulls.append(
            {
                "number": int(item.get("number", 0)),
                "title": str(item.get("title", "")),
                "author": str(((item.get("user") or {}).get("login", "")) or "desconhecido"),
                "state": state,
                "draft": bool(item.get("draft", False)),
                "url": str(item.get("html_url", "")),
                "created_at": str(item.get("created_at", "")),
                "updated_at": str(item.get("updated_at", "")),
            }
        )
    _store(key, pulls)
    return pulls


async def get_stats(user_id: int, owner: str, repo: str, token: str | None, refresh: bool = False) -> dict:
    key = (user_id, "stats", owner.lower(), repo.lower())
    if (hit := _cached(key, refresh)) is not None:
        return hit  # type: ignore[return-value]

    async def count_issues() -> int:
        # O "open_issues_count" do GitHub soma issues E pull requests; a busca conta só as issues.
        response = await _get(
            "/search/issues", token, {"q": f"repo:{owner}/{repo} type:issue state:open", "per_page": 1}
        )
        return int(response.json()["total_count"])

    info_response, issues = await asyncio.gather(
        _get(f"/repos/{owner}/{repo}", token), count_issues(), return_exceptions=True
    )
    if isinstance(info_response, BaseException):
        raise info_response
    info = info_response.json()
    includes_prs = isinstance(issues, BaseException)  # a busca falhou (ex.: limite dela): usa a contagem geral
    stats = {
        "repository": str(info.get("full_name") or f"{owner}/{repo}"),
        "url": str(info.get("html_url", "")),
        "description": info.get("description"),
        "private": bool(info.get("private", False)),
        "language": info.get("language"),
        "stars": int(info.get("stargazers_count", 0)),
        "forks": int(info.get("forks_count", 0)),
        "open_issues": int(info.get("open_issues_count", 0)) if includes_prs else issues,
        "issues_include_pull_requests": includes_prs,
    }
    _store(key, stats)
    return stats
