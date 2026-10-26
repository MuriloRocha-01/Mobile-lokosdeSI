# Convenções do projeto

Ao criar, mover ou editar código, leia e aplique a skill local
[project-architecture](.agents/skills/project-architecture/SKILL.md).

- `mobile/`: aplicativo Expo / React Native em TypeScript. Execute npm e EAS nessa pasta.
- `backend/`: API FastAPI (Python) com SQLite, a mesma usada pelo desktop. Rode e teste nessa pasta (veja `backend/README.md`).
- O mobile consome essa API (hoje hospedada via `DEFAULT_SERVER_URL` em `mobile/src/config/server.ts`). Preserve os contratos entre `backend/app/routers` e `mobile/src/services/api.ts`; uma troca de stack do backend precisa ser solicitada separadamente.
- Antes de escrever código Expo, leia a documentação da versão exata: https://docs.expo.dev/versions/v57.0.0/.
- Preserve funcionalidades e contratos da API ao reorganizar arquivos. Atualize imports, assets e documentação.
- Não versione `.env`, tokens, credenciais, bancos `.db`, dependências ou builds.

Validação do mobile: em `mobile/`, execute `npm ci`, `npx tsc --noEmit` e, quando mudar imports ou assets, `npx expo export --platform web`.
