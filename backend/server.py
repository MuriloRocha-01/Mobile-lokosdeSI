"""Ponto de entrada do backend empacotado com PyInstaller.

    minha-nuvem-backend.exe                   -> inicia a API em 127.0.0.1:8000
"""

import sys

import uvicorn


def main() -> int:
    # Importa o objeto 'app' direto (e não "app.main:app" como texto) para o PyInstaller enxergá-lo.
    # Sem reload=True: recarregar arquivos não faz sentido dentro do executável.
    from app.main import app

    from app.config import API_HOST, API_PORT

    uvicorn.run(app, host=API_HOST, port=API_PORT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
