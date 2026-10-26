import os
from pathlib import Path

# Pasta-raiz dos dados no HD. Tudo o que é do app (notas, projetos, contas e o banco de dados
# database.db) fica dentro dela: para trocar de HD ou de computador basta apontar esta variável.
# Cada item abaixo ainda pode ser trocado individualmente pela sua própria variável.
DATA_ROOT = Path(os.environ.get("DATA_ROOT", "F:\\")).resolve()

# Hub de Projetos: prints e imagens das telas, uma subpasta por projeto (Projetos\<id do projeto>\).
# Pasta separada da "nuvem": o GET /files não a enxerga. Variável: PROJECTS_ROOT.
PROJECTS_ROOT = Path(os.environ.get("PROJECTS_ROOT", DATA_ROOT / "Projetos")).resolve()

# Anexos das notas (fotos e PDFs): uma subpasta por nota (Notas\<id da nota>\<arquivo>). Variável: NOTES_ROOT.
NOTES_ROOT = Path(os.environ.get("NOTES_ROOT", DATA_ROOT / "Notas")).resolve()

# Banco de dados (SQLite): um único arquivo no HD, junto com o resto dos dados, para que o HD
# possa ser levado para outro computador com as contas de usuário. Variável: DATABASE_FILE.
# Fica numa SUBPASTA (Dados), nunca solto na raiz do disco: no Windows um usuário comum consegue
# criar pastas na raiz de um HD secundário, mas não arquivos.
DATABASE_FILE = Path(os.environ.get("DATABASE_FILE", DATA_ROOT / "Dados" / "database.db")).resolve()

# Pasta do app no SSD do usuário: grava mesmo com o HD de dados desconectado, e é gravável mesmo
# com o app instalado em "Arquivos de Programas".
_LOCAL_APPDATA = Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData" / "Local")

# Login (JWT). O segredo que assina os tokens é gerado ao acaso na primeira execução e guardado
# neste arquivo, NO COMPUTADOR (não no HD): cada instalação tem o seu, e ao levar o HD para outro
# PC as pessoas apenas entram de novo. Para testes, a variável JWT_SECRET substitui o arquivo.
JWT_SECRET_FILE = Path(
    os.environ.get("JWT_SECRET_FILE", _LOCAL_APPDATA / "MinhaNuvem" / "jwt_secret")
).resolve()
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.environ.get("JWT_EXPIRE_MINUTES", str(24 * 60)))  # 24 h

# Chave que criptografa segredos guardados no banco (hoje: o token do GitHub). Como o segredo do
# login, fica NO COMPUTADOR e não no HD: quem obtiver só o HD (ou uma cópia do database.db) não
# consegue ler o token. Consequência: ao levar o HD para outro PC, o token precisa ser salvo de novo.
SECRETS_KEY_FILE = Path(
    os.environ.get("SECRETS_KEY_FILE", _LOCAL_APPDATA / "MinhaNuvem" / "secrets.key")
).resolve()

# Espaço das contas convidadas: cada conta ganha uma pasta própria (Convidados\<id da conta>\), onde
# ficam os anexos de notas e as imagens de projetos dela.
GUESTS_ROOT = Path(os.environ.get("GUESTS_ROOT", DATA_ROOT / "Convidados")).resolve()
# Limite de espaço de cada convidado (para um amigo não encher o seu HD). Variável: GUEST_QUOTA_GB.
GUEST_QUOTA_BYTES = int(float(os.environ.get("GUEST_QUOTA_GB", "10")) * 1024**3)

# Onde o servidor escuta. O padrão (só este computador) é o mais seguro: para outros PCs chegarem
# nele use o Tailscale ("tailscale serve"), que o publica só para a sua rede privada, com HTTPS.
API_HOST = os.environ.get("API_HOST", "127.0.0.1")
API_PORT = int(os.environ.get("API_PORT", "8000"))

# Atualizações do próprio app desktop: o instalador mais novo (.exe), o .blockmap e o latest.yml
# ficam aqui (publish-update.ps1, na raiz do projeto, os copia para cá depois de cada build). O app
# Electron (de quem instalou, dono ou convidado — todos apontam para o SEU servidor) busca essa
# pasta pelo endereço já configurado (Tailscale incluso): ninguém reinstala na mão de novo.
# Variável: UPDATES_ROOT.
UPDATES_ROOT = Path(os.environ.get("UPDATES_ROOT", DATA_ROOT / "Atualizacoes")).resolve()

# API do GitHub. Só muda em testes (um servidor de mentira local); o token só é enviado para cá.
GITHUB_API_URL = os.environ.get("GITHUB_API_URL", "https://api.github.com").rstrip("/")

# Só para trazer os dados de um PC para um servidor novo (ver migrate_routes.py): sem esta variável
# configurada, a rota de migração nem é registrada. Tire-a do servidor depois de usar uma vez.
MIGRATION_TOKEN = os.environ.get("MIGRATION_TOKEN", "")
