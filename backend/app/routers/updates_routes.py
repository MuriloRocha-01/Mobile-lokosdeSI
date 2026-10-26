"""Atualizações do app desktop: serve o instalador mais novo (.exe), o .blockmap e o latest.yml que
o electron-updater busca sozinho (ver main.ts, no Electron). O publish-update.ps1 (raiz do projeto)
copia esses três arquivos para cá depois de cada build — o backend só os serve, nunca os gera.

Sem login: o app confere isso antes mesmo de alguém estar logado (é a primeira coisa que ele faz ao
abrir), e são só binários do instalador — nada sensível. Continua só na rede privada (Tailscale) de
quem o dono convidar, como o resto do servidor.
"""

import json
import mimetypes
from pydantic import BaseModel, Field, model_validator
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from ..config import UPDATES_ROOT
from ..storage import resolve_under

router = APIRouter(prefix="/updates", tags=["atualizações"])

_MEDIA_TYPES = {".yml": "text/yaml", ".yaml": "text/yaml", ".exe": "application/octet-stream", ".blockmap": "application/octet-stream"}


def ensure_updates_root() -> None:
    """Cria a pasta de atualizações se a unidade existir (não derruba o servidor se não estiver)."""
    if Path(UPDATES_ROOT.anchor).exists():
        UPDATES_ROOT.mkdir(parents=True, exist_ok=True)


class MobileRelease(BaseModel):
    version: str = Field(min_length=1, max_length=30)
    build_number: int = Field(ge=1)
    min_build_number: int = Field(ge=1)
    android_apk: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$")
    md5: str = Field(pattern=r"^[0-9a-f]{32}$")
    notes: str = Field(default="", max_length=2000)

    @model_validator(mode="after")
    def valid_minimum(self):
        if self.min_build_number > self.build_number:
            raise ValueError("A versão mínima não pode superar a versão publicada.")
        return self


@router.get("/mobile/manifest", response_model=MobileRelease | None)
def mobile_manifest():
    path = UPDATES_ROOT / "mobile.json"
    if not path.is_file():
        return None
    try:
        release = MobileRelease.model_validate(json.loads(path.read_text(encoding="utf-8-sig")))
        if not resolve_under(UPDATES_ROOT, release.android_apk).is_file():
            raise ValueError("APK ausente")
        return release
    except (ValueError, OSError):
        raise HTTPException(503, "A atualização está sendo preparada. Tente novamente.")


@router.get("/{filename}")
def get_update_file(filename: str) -> FileResponse:
    """Um arquivo da pasta de atualizações (o electron-updater busca 'latest.yml' e o instalador que ele apontar)."""
    if "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Nome de arquivo inválido.")
    path = resolve_under(UPDATES_ROOT, filename)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Nenhuma atualização com esse nome.")
    media_type = _MEDIA_TYPES.get(path.suffix.lower()) or mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    return FileResponse(path, media_type=media_type, filename=path.name)
