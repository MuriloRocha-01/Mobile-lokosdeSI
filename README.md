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

## Deploy gratuito (Render + Supabase)

O `render.yaml` define um serviço web Python com `rootDir: backend`; os dados ficam num Postgres gratuito do Supabase.

1. No Supabase, crie um projeto e copie a **Session pooler connection string** (Connect → Session pooler).
2. No Render, crie um **Blueprint** apontando para este repositório e cole a string em `DATABASE_URL` quando pedir.
3. O app aponta para `https://mobile-lokosdesi-backend.onrender.com` (`DEFAULT_SERVER_URL` em `mobile/src/config/server.ts`). Ao trocar de host, altere essa constante e gere um novo build.

Limites do plano gratuito: o serviço do Render dorme após inatividade (a primeira chamada leva cerca de 50 s) e o projeto do Supabase é pausado após 7 dias sem uso (dá para reativar no painel, sem perder dados). Anexos de notas e imagens de projetos ficam em disco temporário e somem a cada reinício.

## Organização

O mobile separa tipos, assets, componentes, configurações, hooks, navegação, telas, serviços e utilitários em `mobile/src/`. `App.tsx` mantém os providers; `src/routes/AppRoutes.tsx` controla a navegação existente. A [skill de arquitetura](.agents/skills/project-architecture/SKILL.md) descreve onde colocar código novo. Leia também [AGENTS.md](AGENTS.md).
