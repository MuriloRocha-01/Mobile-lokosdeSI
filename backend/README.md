# Backend

Estrutura reservada para a futura API REST em Node.js:

```text
src/
  config/
  controllers/
  models/
  services/
  middlewares/
  routes/
```

Esta pasta ainda não possui servidor, dependências ou banco. O aplicativo em `../mobile/` continua usando a API FastAPI externa do desktop.

Quando a API Node.js for implementada, `src/app.js` configurará o Express, `server.js` iniciará a porta e `package.json` definirá dependências e scripts. O arquivo `.env` será local e ignorado pelo Git.

As responsabilidades de cada camada estão na [skill de arquitetura](../.agents/skills/project-architecture/SKILL.md).
