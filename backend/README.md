# Backend

API FastAPI com SQLite (local) ou Postgres (hospedado), usada pelo aplicativo mobile e pelo desktop.

```text
app/
  main.py          Criação do FastAPI, CORS, rota /health e registro dos routers
  config.py        Caminhos e variáveis de ambiente
  database.py      Conexão, migrações aditivas e backup do SQLite
  models.py        Tabelas
  schemas.py       Contratos de entrada e saída
  auth.py          JWT, hash de senha e sessões renováveis
  routers/         Rotas por área: finance, planning, agenda, notes, projects, auth, ...
scripts/           Utilitários (ex.: migrate_to_server.py)
tests/             Testes com banco temporário
run.py             Servidor local com reload
server.py          Servidor empacotado para o desktop
Procfile           Comando de start (Railway/Heroku)
railway.json       Healthcheck no Railway
```

## Rodar localmente

```bash
python -m venv .venv
.venv/Scripts/activate        # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python run.py
```

## Variáveis de ambiente

| Variável | Uso |
| --- | --- |
| `DATABASE_URL` | Postgres (ex.: Supabase). Se definida, substitui o SQLite. Aceita `postgres://`, `postgresql://` ou `postgresql+psycopg://` |
| `JWT_SECRET` | Segredo dos tokens (mínimo 32 caracteres). Sem ela, é gerado e salvo em arquivo local |
| `DATA_ROOT` | Pasta base dos dados (padrão `F:\`, ajuste em servidores Linux, ex.: `/var/data`) |
| `DATABASE_FILE` | Caminho do SQLite (padrão `DATA_ROOT/Dados/database.db`) |
| `PROJECTS_ROOT`, `NOTES_ROOT` | Pastas de projetos e notas |
| `JWT_SECRET_FILE` | Arquivo onde o segredo gerado é guardado |

Nunca versione `.env`, segredos ou o arquivo `.db`.

## Testes

```bash
python -m pytest tests          # ou: python tests/test_mobile.py
```

Os testes usam apenas banco temporário.

## Deploy

- **Render + Supabase (gratuito):** use o `render.yaml` da raiz (`rootDir: backend`) e defina `DATABASE_URL` com a connection string do Supabase (use o *Session pooler*). Os dados ficam no Postgres e sobrevivem a reinícios; anexos de notas e imagens de projetos continuam em disco temporário.
- **Railway:** `Procfile` e `railway.json` continuam válidos.
