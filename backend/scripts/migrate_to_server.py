"""Empacota os dados reais deste PC (banco + Notas + Projetos) e manda para o servidor novo.

Uso (dentro de backend\\, com o .venv ativado):
    python scripts\\migrate_to_server.py --url https://SEU-PROJETO.up.railway.app --token SEU_MIGRATION_TOKEN

Sem --url/--token, só empacota em migration.zip (na pasta atual) para você conferir ou mandar na mão.

Isso SUBSTITUI o banco de dados do servidor de destino inteiro — pensado para rodar uma vez, logo
depois de criar o servidor (ver MIGRATION_TOKEN em backend/app/config.py e migrate_routes.py).
"""

import argparse
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.config import DATABASE_FILE, NOTES_ROOT, PROJECTS_ROOT  # noqa: E402


def pack(zip_path: Path) -> None:
    print(f"Banco: {DATABASE_FILE} ({'existe' if DATABASE_FILE.exists() else 'NÃO EXISTE'})")
    print(f"Notas: {NOTES_ROOT} ({'existe' if NOTES_ROOT.exists() else 'não existe, ok'})")
    print(f"Projetos: {PROJECTS_ROOT} ({'existe' if PROJECTS_ROOT.exists() else 'não existe, ok'})")

    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        if DATABASE_FILE.exists():
            zf.write(DATABASE_FILE, "database.db")
        for name, root in (("Notas", NOTES_ROOT), ("Projetos", PROJECTS_ROOT)):
            if not root.exists():
                continue
            for path in root.rglob("*"):
                if path.is_file():
                    zf.write(path, str(Path(name) / path.relative_to(root)))
    size_mb = zip_path.stat().st_size / 1024 / 1024
    print(f"\nEmpacotado: {zip_path} ({size_mb:.1f} MB)")


def upload(zip_path: Path, url: str, token: str) -> None:
    import httpx

    endpoint = url.rstrip("/") + "/migrate/restore"
    print(f"\nEnviando para {endpoint} ...")
    with zip_path.open("rb") as f:
        response = httpx.post(
            endpoint,
            headers={"X-Migration-Token": token},
            files={"file": ("migration.zip", f, "application/zip")},
            timeout=120,
        )
    if response.status_code != 200:
        print(f"FALHOU ({response.status_code}): {response.text}")
        sys.exit(1)
    print("OK:", response.json())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", help="Endereço do servidor novo (ex.: https://xxx.up.railway.app)")
    parser.add_argument("--token", help="O mesmo valor de MIGRATION_TOKEN configurado no servidor")
    parser.add_argument("--out", default="migration.zip", help="Onde salvar o .zip (padrão: migration.zip)")
    parser.add_argument("--yes", action="store_true", help="Não pede confirmação interativa (para rodar de forma não-interativa)")
    args = parser.parse_args()

    zip_path = Path(args.out).resolve()
    pack(zip_path)

    if args.url and args.token:
        if not args.yes:
            confirm = input(f"\nIsso vai SUBSTITUIR o banco de dados de {args.url}. Digite SIM para continuar: ")
            if confirm.strip().upper() != "SIM":
                print("Cancelado.")
                return
        upload(zip_path, args.url, args.token)
    elif args.url or args.token:
        print("\nPara enviar, informe --url E --token juntos. Por enquanto só empacotei o .zip.")


if __name__ == "__main__":
    main()
