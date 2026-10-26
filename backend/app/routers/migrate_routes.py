"""Rota de uso único: trazer os dados reais (banco + notas + projetos) de um PC para este servidor,
na primeira vez que ele sobe hospedado (Railway ou parecido).

Só existe se a variável MIGRATION_TOKEN estiver configurada — sem ela, a rota nem é registrada (ver
main.py). Depois de migrar os dados uma vez, REMOVA a variável MIGRATION_TOKEN do servidor (ou apague
este arquivo e a linha que o registra em main.py): ela é a única coisa que protege um endpoint capaz
de substituir o banco de dados inteiro.
"""

import shutil
import tempfile
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

from ..config import DATABASE_FILE, MIGRATION_TOKEN, NOTES_ROOT, PROJECTS_ROOT
from ..database import IS_SQLITE, engine

router = APIRouter(prefix="/migrate", tags=["migração"])

# Só estas duas pastas + o banco: Arquivos e Cofre foram removidos, então Convidados/<id>/Nuvem e
# /Cofre (se existirem, de antes) não têm mais nada que os leia — não valem a pena migrar.
_FOLDERS = {"Notas": NOTES_ROOT, "Projetos": PROJECTS_ROOT}


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> None:
    """extractall, mas recusando qualquer nome que tente escapar de 'dest' (zip-slip)."""
    dest = dest.resolve()
    for name in zf.namelist():
        target = (dest / name).resolve()
        if target != dest and dest not in target.parents:
            raise HTTPException(400, f"Nome inválido dentro do arquivo: {name}")
    zf.extractall(dest)


@router.post("/restore")
async def restore(file: UploadFile = File(...), x_migration_token: str = Header(default="")) -> dict:
    """Recebe um .zip (ver scripts/pack_migration.py) com database.db, Notas/ e Projetos/, e troca
    o que este servidor tem por isso. Sobrescreve de vez: pensado para rodar uma única vez, em um
    servidor recém-criado (sem dado nenhum de valor ainda)."""
    if not IS_SQLITE:
        raise HTTPException(501, "Migração por arquivo só existe no modo SQLite.")
    if not MIGRATION_TOKEN:
        raise HTTPException(503, "MIGRATION_TOKEN não configurado neste servidor.")
    if x_migration_token != MIGRATION_TOKEN:
        raise HTTPException(403, "Token de migração inválido.")

    with tempfile.TemporaryDirectory() as tmp_name:
        tmp = Path(tmp_name)
        zip_path = tmp / "upload.zip"
        zip_path.write_bytes(await file.read())
        try:
            with zipfile.ZipFile(zip_path) as zf:
                _safe_extract(zf, tmp / "content")
        except zipfile.BadZipFile:
            raise HTTPException(400, "O arquivo enviado não é um .zip válido.") from None
        content = tmp / "content"

        # Fecha as ligações abertas com o banco ATUAL antes de trocar o arquivo por baixo delas.
        engine.dispose()

        moved = []
        src_db = content / "database.db"
        if src_db.exists():
            DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src_db, DATABASE_FILE)
            moved.append("database.db")

        for name, root in _FOLDERS.items():
            src = content / name
            if not src.exists():
                continue
            if root.exists():
                shutil.rmtree(root)
            shutil.copytree(src, root)
            moved.append(name)

    return {"status": "ok", "moved": moved}
