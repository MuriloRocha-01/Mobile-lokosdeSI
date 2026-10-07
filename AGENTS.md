# Convenções do projeto

Ao criar, mover ou editar código, leia e aplique a skill local
[project-architecture](.agents/skills/project-architecture/SKILL.md).

- `mobile/`: aplicativo Expo / React Native em TypeScript. Execute npm e EAS nessa pasta.
- `backend/`: estrutura reservada para uma API REST Node.js; ainda não existe implementação local.
- O mobile continua consumindo o servidor FastAPI externo do desktop. Uma migração de backend precisa ser solicitada separadamente.
- Antes de escrever código Expo, leia a documentação da versão exata: https://docs.expo.dev/versions/v57.0.0/.
- Preserve funcionalidades e contratos da API ao reorganizar arquivos. Atualize imports, assets e documentação.
- Não versione `.env`, tokens, credenciais, dependências ou builds.

Validação do mobile: em `mobile/`, execute `npm ci`, `npx tsc --noEmit` e, quando mudar imports ou assets, `npx expo export --platform web`.
