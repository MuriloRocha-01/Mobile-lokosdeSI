import os
from pathlib import Path

from fastapi import HTTPException

from .config import DATA_ROOT, GUESTS_ROOT


def ensure_data_root() -> None:
    """Confere que o HD de dados está conectado (senão nada mais no app funciona: banco, notas, projetos...)."""
    if not Path(DATA_ROOT.anchor).exists():
        raise RuntimeError(
            f"A unidade {DATA_ROOT.anchor} não foi encontrada. "
            "Conecte o HD secundário ou ajuste a variável DATA_ROOT."
        )
    DATA_ROOT.mkdir(parents=True, exist_ok=True)


def resolve_under(root: Path, relative: str = "") -> Path:
    """Converte um caminho relativo em um caminho absoluto dentro de 'root'.

    Bloqueia tentativas de sair da pasta raiz (ex: '..\\..\\Windows' ou 'C:\\Windows').
    """
    target = (root / relative).resolve()
    if target != root and root not in target.parents:
        raise HTTPException(status_code=400, detail="Caminho inválido.")
    return target


def guest_base(user_id: int) -> Path:
    """Onde fica o espaço de uma conta convidada no HD: Convidados/<id>/."""
    return GUESTS_ROOT / str(user_id)


def folder_size(root: Path) -> int:
    """Soma do tamanho de tudo dentro de uma pasta."""
    total = 0
    for dirpath, _dirs, files in os.walk(root):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(dirpath, name))
            except OSError:
                pass  # arquivo sumiu no meio da contagem
    return total
