"""Criptografia de segredos guardados no banco (Fernet: AES-128-CBC + HMAC-SHA256).

A chave é gerada ao acaso na primeira vez e fica em SECRETS_KEY_FILE, no computador (não no HD).
"""

import os
import threading

from cryptography.fernet import Fernet, InvalidToken

from .config import SECRETS_KEY_FILE

_lock = threading.Lock()
_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    global _fernet
    with _lock:
        if _fernet is None:
            key = os.environ.get("SECRETS_KEY", "").encode()  # só para testes
            if not key:
                try:
                    key = SECRETS_KEY_FILE.read_bytes().strip()
                except FileNotFoundError:
                    key = b""
                if not key:
                    key = Fernet.generate_key()
                    SECRETS_KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
                    tmp = SECRETS_KEY_FILE.with_name(SECRETS_KEY_FILE.name + ".tmp")
                    tmp.write_bytes(key)
                    os.replace(tmp, SECRETS_KEY_FILE)  # troca atômica: nunca fica um arquivo pela metade
            _fernet = Fernet(key)
        return _fernet


def encrypt(text: str) -> str:
    return _get_fernet().encrypt(text.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str | None:
    """O texto original, ou None se não dá para ler (chave de outro computador, dado adulterado)."""
    try:
        return _get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
