---
name: project-architecture
description: Organizar e implementar código no Lokos de S.I seguindo as camadas de backend e mobile. Use ao criar, editar ou mover arquivos neste repositório.
---

# Arquitetura do Lokos de S.I

## Raiz

Mantenha o aplicativo em `mobile/`, a API local em `backend/`, e documentação e instruções compartilhadas na raiz. Cada aplicação possui seu próprio package.json e dependências. O mobile atual usa Expo 57, React Native 0.86 e TypeScript; preserve `.tsx` e `.ts`, sem converter para JavaScript.

`backend/` contém apenas a estrutura de pastas. O servidor usado hoje é FastAPI externo, compartilhado com o desktop. Não crie uma API fictícia nem troque o servidor para cumprir a organização. Quando houver uma missão explícita de implementação Node.js, use a distribuição abaixo.

## Backend Node.js

| Caminho | Responsabilidade |
| --- | --- |
| `backend/src/config/` | Banco de dados, leitura de ambiente e configuração de bibliotecas |
| `backend/src/controllers/` | Receber HTTP, validar formato da entrada e enviar respostas; delegar regras aos services |
| `backend/src/models/` | Esquemas e tabelas do ORM escolhido pelo projeto |
| `backend/src/services/` | Regras de negócio, cálculos e validações de domínio |
| `backend/src/middlewares/` | Autenticação, autorização e filtros HTTP |
| `backend/src/routes/` | Endpoints ligados a middlewares e controllers |
| `backend/src/app.js` | Configurar Express, middlewares globais e rotas |
| `backend/server.js` | Inicializar o servidor e escutar a porta |
| `backend/package.json` | Dependências e scripts do backend |
| `backend/.env` | Segredos locais, nunca versionados; documentar nomes em `.env.example` quando necessário |

Não instale Express, ORM ou banco até a implementação precisar deles. Não coloque cálculos de domínio nos controllers ou nas rotas.

## Mobile

| Caminho | Responsabilidade |
| --- | --- |
| `mobile/src/@types/` | Tipos compartilhados, contratos da API e declarações globais quando necessárias |
| `mobile/src/assets/` | Imagens, ícones, fontes e animações |
| `mobile/src/components/` | Componentes visuais reutilizáveis |
| `mobile/src/config/` | Tema e configurações globais |
| `mobile/src/hooks/` | Hooks e contexto de autenticação (`useAuth.tsx`) |
| `mobile/src/routes/` | Navegação, abas, overlays e botão voltar (`AppRoutes.tsx`) |
| `mobile/src/screens/` | Telas completas e composição da interface |
| `mobile/src/services/` | Cliente HTTP (`api.ts`), armazenamento e notificações locais (`reminders/`) |
| `mobile/src/utils/` | Funções compartilhadas de calendário, moeda, validação de formulários e interações nativas |
| `mobile/App.tsx` | Componente raiz, providers e composição da navegação |
| `mobile/index.ts` | Registro do componente raiz no Expo |
| `mobile/app.json` | Metadados e plugins do Expo; assets relativos a `mobile/` |
| `mobile/eas.json` | Perfis de build EAS |
| `mobile/package.json` | Dependências e scripts do mobile |
| `mobile/tsconfig.json` | Configuração TypeScript |

Use o cliente HTTP existente em services; não introduza Axios nem React Navigation apenas para preencher o exemplo de arquitetura. A navegação atual usa estado React em routes. Extraia novos hooks quando houver lógica visual reutilizável; não crie wrappers vazios. Cálculos financeiros autoritativos e geração de recorrências continuam no servidor.

## Convenção visual

O mobile oferece tema claro com lavanda e violeta, e tema escuro com preto, grafite e ações brancas, ambos com cartões arredondados. No escuro, use o fundo decorativo local IridescentBackdrop apenas nos cartões de saldo e valor; mantenha textos e valores como conteúdo real por cima da imagem. As listas escuras usam divisores discretos, ícones neutros e navegação em uma barra arredondada. Centralize paletas, raios e sombras em `mobile/src/config/theme.ts`. Consuma as cores com `useTheme()` de `mobile/src/hooks/useTheme.tsx`; gere os estilos a partir da paleta dentro do componente para que a troca seja imediata. Não capture cores em estilos estáticos no nível do módulo. `ThemeProvider` mantém e salva a preferência local; o seletor fica em Conta → Aparência e o claro é o padrão. Preserve o estado dos formulários ao trocar o tema, sem remontar a aplicação.

Use `primary` para ações e seleções; reserve `income` e `expense` para valores e estados financeiros. Use `text` para texto sobre superfícies e `onPrimary` sobre botões. Preserve contraste, fontes ajustáveis e alvos de toque de pelo menos 44 px nas ações principais. A barra de status deve acompanhar o tema escolhido.

Use `EmptyState` e `NoticeBanner` para estados vazios e confirmações. O ícone escolhido pelo usuário está em `mobile/src/assets/icon.png`, extraído do `favicon.zip` da raiz; o favicon web está em `mobile/src/assets/favicon.png`. Não substitua esses assets pelo logo padrão do Expo.

## Servidor e integrações bancárias do mobile

O servidor de produção já fica definido em `mobile/src/config/server.ts`: Railway em `https://backend-production-5c98b.up.railway.app`. O login pede apenas e-mail e senha; não exija digitação de endereço/código do servidor. Não reutilize tokens de outro endereço e não embuta credenciais no código. Preserve os contratos FastAPI; não altere o desktop ou crie backend local para esta integração.

Importação em `services/statementParser.ts`, `statementFile.ts` e `statementImport.ts`, com composição em `screens/ImportStatementScreen.tsx`: leia OFX/CSV localmente, valide centavos/datas e mantenha prévia, categorias e confirmação antes de enviar pela API existente. Arquivos até 2 MB, 1.000 registros e moeda BRL. CSV exige mapeamento/convenção de sinal; não presuma formatos fixos dos bancos. A leitura nativa usa DocumentPicker e FileSystem Expo 57; apague a cópia de cache após a leitura. Não persista extratos ou seus textos em logs.

Duplicação aproximada usa data/tipo/valor/descrição com contagem de ocorrências. Mostre possíveis duplicados desmarcados; nunca descarte silenciosamente pagamentos legítimos. Preserve sucessos parciais e bloqueie novo envio após resposta incerta até consultar novamente. A API atual não persiste FITID/chave de idempotência: documente essa limitação, sem prometer deduplicação entre aparelhos/notificações/importações.

Notificações CAIXA/Nubank: regras conservadoras em `services/bankNotification.ts`, prévia sem gravação e instruções Tasker em `BankAutomationScreen.tsx`. A captura precisa ser configurada no Tasker Android; o mobile não possui listener de notificações de outros apps. Não considere qualquer mensagem com R$ um gasto. Filtre origem, direção, confirmação e ambiguidades; valide mensagens reais antes de ampliar regras. Sem data explícita, usa o dia da captura. Script Tasker não contém senha/token e usa a rota autenticada existente. O histórico local reserva antes do POST; falha não autoriza retry automático. Documente limites de entrega e deduplicação.

Ao alterar regras, gere `mobile/automation/tasker-notifications.js` e `mobile/src/config/taskerScript.ts` com `node scripts/check-import.cjs --write-tasker` e rode `npm run check:import` dentro de mobile. O gerador roda apenas no Node: não use Function.toString() no app, pois Hermes não preserva o fonte das funções compiladas. Verifique também o script mostrado pelo bundle. Novas dependências nativas exigem novo build do APK.

## Verificação

Execute comandos do app dentro de `mobile/`. Depois de mover arquivos, revise todos os imports relativos, o entrypoint, os caminhos de assets do app.json e os comandos no README. Confira tipos com `npx tsc --noEmit` e empacotamento com `npx expo export --platform web` quando a mudança afetar resolução de módulos ou assets. Notificações e comportamento nativo ainda exigem aparelho ou emulador.
