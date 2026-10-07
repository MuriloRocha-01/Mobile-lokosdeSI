# Lokos de S.I

```text
backend/                     Estrutura para futura API REST Node.js
mobile/                      Aplicativo Expo / React Native em TypeScript
.agents/skills/              Convenções para trabalhar com IA
AGENTS.md                    Instruções de entrada para agentes
```

O aplicativo mobile usa o mesmo servidor FastAPI e a mesma conta do desktop. A pasta `backend/` ainda não contém uma implementação Node.js.

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
npx tsc --noEmit
npx eas-cli build --profile preview --platform android
```

Veja funcionalidades, conexão ao servidor e detalhes de build no [README do mobile](mobile/README.md). Configure ferramentas de build para usar `mobile/` como diretório do aplicativo.

## Organização

O mobile separa tipos, assets, componentes, configurações, hooks, navegação, telas, serviços e utilitários em `mobile/src/`. `App.tsx` mantém os providers; `src/routes/AppRoutes.tsx` controla a navegação existente.

A [skill de arquitetura](.agents/skills/project-architecture/SKILL.md) descreve onde colocar código novo e as responsabilidades das camadas. Leia também [AGENTS.md](AGENTS.md).
