# Lokos de S.I

Finanças e agenda pessoais: aplicativo Android (Expo / React Native) e a API FastAPI que o atende.

```text
backend/                     API FastAPI (Python) + SQLite
mobile/                      Aplicativo Expo / React Native em TypeScript
docs/                        Documentação e diagramas (fluxograma.html)
.agents/skills/              Convenções para trabalhar com IA
render.yaml                  Deploy do backend no Render
AGENTS.md                    Instruções de entrada para agentes
```

O aplicativo mobile usa a mesma conta e o mesmo servidor do app desktop.

## Desenvolvimento mobile

```bash
cd mobile
npm ci
npm start
```

Outros comandos, executados em `mobile/`:

```bash
npm run android
npm run web
npm test
npx tsc --noEmit
npx eas-cli build --profile preview --platform android
```

Veja funcionalidades, conexão ao servidor e detalhes de build no [README do mobile](mobile/README.md).

## Desenvolvimento do backend

```bash
cd backend
python -m venv .venv
.venv/Scripts/activate        # Linux/macOS: source .venv/bin/activate
pip install -r requirements.txt
python run.py                 # http://127.0.0.1:8000, rota de saúde em /health
```

Detalhes e variáveis de ambiente no [README do backend](backend/README.md).

## Deploy no Render

O arquivo `render.yaml` define um serviço web Python com `rootDir: backend`. No Render, crie um **Blueprint** apontando para este repositório (ou um Web Service com Root Directory `backend`, build `pip install -r requirements.txt` e start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`). O plano gratuito não tem disco persistente: o SQLite é apagado a cada deploy. Para manter os dados, use um disco (plano pago) ou um banco externo.

Depois de publicar, troque `DEFAULT_SERVER_URL` em `mobile/src/config/server.ts` pela URL do Render e gere um novo build do app.

## Organização

O mobile separa tipos, assets, componentes, configurações, hooks, navegação, telas, serviços e utilitários em `mobile/src/`. `App.tsx` mantém os providers; `src/routes/AppRoutes.tsx` controla a navegação existente. A [skill de arquitetura](.agents/skills/project-architecture/SKILL.md) descreve onde colocar código novo. Leia também [AGENTS.md](AGENTS.md).
