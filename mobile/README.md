# Lokos de S.I — app de celular (Expo / React Native)

Companion Android do **Lokos de S.I**. Usa a **mesma conta e o mesmo servidor** do app desktop: tudo o que você lança no
celular aparece no PC e vice-versa (nada fica só no aparelho).

- Expo SDK 57 · React Native 0.86 · TypeScript
- Versão atual: **1.2.0** (`versionCode` 3)
- O calendário é feito em JS puro (sem biblioteca nativa de datas), para não depender de módulos nativos.

## Funcionalidades

### Design
- Temas claro e escuro: escolha em **Conta → Aparência**. A troca é imediata e a preferência fica salva neste aparelho, inclusive após sair da conta. O claro é o padrão.
- Tema escuro inspirado na referência financeira: preto, grafite, ações brancas e cartões iridescentes de saldo/valor.
- Paletas e estilos compartilhados ficam em `src/config/theme.ts`; `src/hooks/useTheme.tsx` fornece cores reativas e persistência da preferência.
- Finanças tem atalho para a conta no avatar; telas vazias orientam o próximo passo.
- Login permite mostrar/ocultar a senha.
- Ícone do aplicativo e favicon web usam as imagens fornecidas em `favicon.zip` na raiz.
- Alterações no ícone e na configuração nativa exigem gerar e instalar um novo build para aparecer no celular.

O app tem 4 abas: **Finanças · Extrato · Agenda · Conta**.

### Login e conta
- Pede apenas **e-mail** e **senha**. O endereço `https://backend-production-5c98b.up.railway.app` já está definido em `src/config/server.ts`.
- Tokens antigos vinculados a outro servidor não são enviados ao Railway; nesse caso é necessário entrar novamente.
- A sessão fica no cofre do sistema (`expo-secure-store`); nas próximas vezes entra sozinho.
- Aba **Conta**: dados do usuário, sair, e configuração dos lembretes da agenda.

### Importação de extratos e notificações bancárias

- **Conta → Seus bancos → Importar extrato OFX/CSV**: arquivo local de até 2 MB e 1.000 registros. O arquivo fica no celular; apenas os lançamentos selecionados são enviados pela rota existente `POST /finance/transactions`.
- OFX XML/SGML em BRL: lê data, valor com sinal, descrição e FITID; recusa datas/valores inválidos, identificadores repetidos, correções e moeda estrangeira. Sem saldo de abertura importado como receita. UTF-8; converta arquivos antigos com codificação incompatível antes de selecionar.
- CSV com cabeçalho e separador vírgula, ponto e vírgula ou tabulação: escolha colunas de data/descrição/valor ou débito/crédito separados, separador decimal e convenção de sinal. Para faturas, positivo pode representar despesa; para conta, negativo representa despesa. Não presume um layout fixo de CAIXA/Nubank.
- Prévia com seleção individual, totais em centavos, categorias por tipo e por registro. Possíveis duplicados (data/tipo/valor/descrição) ficam desmarcados. Dois pagamentos legítimos podem ter os mesmos dados: revise antes de marcar.
- Envio sequencial, sem rollback: sucessos são preservados na tela. Em falha ou timeout, interrompe e exige nova consulta ao servidor antes de continuar. O backend atual não oferece chave de idempotência/FITID persistido, portanto a verificação é aproximada, sem garantia contra concorrência ou sobreposição de notificações/extratos.
- **Conta → Seus bancos → Notificações bancárias / Tasker**: teste do texto sem salvar, IDs de categorias, script e instruções de HTTP/autenticação. Script independente: `automation/tasker-notifications.js`. Configure o Tasker no Android, selecionando apenas o app oficial do banco (ou SMS de remetente verificado). O mobile não solicita acesso às notificações de outros apps.
- Regras conservadoras para compra aprovada/realizada e Pix recebido/enviado com um único valor em reais. Mensagens reais podem exigir ajuste: ainda não foram fornecidas amostras dos bancos. Data ausente usa o dia da captura; não reprocesse notificações antigas sem corrigir a data.
- Tasker: teste com `%mode=preview`; envio com `%mode=send`; confirmação com `%mode=confirm`. HTTP POST com Bearer obtido no login, sem credenciais embutidas. Configure colisão `Abort New Task`; a reserva local bloqueia repetição da mensagem e retry incerto. Não há garantia de entrega offline: mensagens ignoradas, falhas ou eventos bloqueados precisam de revisão manual/importação do extrato. Histórico limita-se a 500 registros e deve ser arquivado/revisado antes de limpar.
- iOS: use OFX/CSV; este fluxo Tasker é Android. Notificações bancárias e seleção nativa de documentos ainda precisam de validação em aparelho real. Novas dependências nativas exigem gerar um novo APK.
- Verificação sem rede: `npm run check:import`. Depois de alterar o parser de notificações, regenere o script com `node scripts/check-import.cjs --write-tasker` e rode a verificação novamente.

Referências: [Expo DocumentPicker](https://docs.expo.dev/versions/v57.0.0/sdk/document-picker/), [Expo FileSystem](https://docs.expo.dev/versions/v57.0.0/sdk/filesystem/), [Tasker HTTP Request](https://tasker.joaoapps.com/userguide/en/help/ah_http_request.html), [Tasker JavaScript](https://tasker.joaoapps.com/userguide/en/javascript.html).

### Finanças
- Três cartões **clicáveis**: **Saldo atual**, **Receitas** e **Despesas** do mês.
  - **Saldo atual** abre a tela de detalhes: resumo do mês, comparação com o mês anterior (variação %),
    "sobrou/faltou no mês", % guardado, nº de transações e despesas por categoria com barra. Tem seletor ‹ › de mês.
  - **Receitas** / **Despesas** abrem o **Extrato** já filtrado pelo tipo, no mês atual.
- **Últimas transações** (15) com link **Ver tudo** para o Extrato.
  - Toque na linha → **editar**. Segurar → **apagar** (com confirmação).
  - Transações de gasto fixo mostram um ícone de "repetir".
- Botão **+** (FAB) para lançar uma nova transação.

### Extrato (transações por período)
- Filtro por tipo: **Tudo / Receitas / Despesas**.
- Períodos prontos: **Este mês · Mês passado · 30 dias · Este ano**, ou **Escolher período** com calendário
  (intervalo de até **366 dias**).
- Cartão de totais do período (receitas, despesas e saldo) e contagem de transações.
- Lista paginada (50 por vez), puxar para atualizar. Toque edita, segurar apaga.
- O filtro escolhido é mantido enquanto você edita uma transação e volta.

### Lançar / editar transação
- **Despesa** ou **Receita**.
- **Valor** com o teclado numérico padrão do celular (`decimal-pad`). Aceita `12,50`, `12.50` e `1.234,56`;
  mostra a prévia em reais embaixo.
- **Motivo** (categoria) em chips com emoji. Chip **＋ Nova** cria uma categoria; **segurar** uma categoria sua
  abre editar/apagar. Categorias padrão do sistema não podem ser apagadas.
  - Categoria nova: nome, emoji (36 sugestões ou qualquer emoji do teclado) e uma de 8 cores, com prévia.
- **Data**: Hoje / Ontem / calendário.
- **Descrição** opcional.
- **Gasto fixo — repetir**: **Todo mês** ou **Todo ano**, **sem fim** ou **até uma data** (calendário).
  - O servidor cria as ocorrências vencidas automaticamente quando você abre Finanças/Extrato.
  - A transação **original** pode ter a repetição editada; as **ocorrências geradas** são transações comuns
    (editar valor/descrição/data é livre, mas não dá para mudar a repetição delas).
  - Apagar a original **mantém** as ocorrências já geradas.

### Agenda
- Próximos **14 dias**: compromissos, tarefas e **rotinas** (todo dia, dias úteis, dias da semana escolhidos, todo mês).
- **+** cria um item com dia, hora, repetição e aviso; o círculo marca como feito (numa rotina, só aquele dia).
- **Lembretes** são notificações agendadas no próprio celular (`expo-notifications`): chegam mesmo com o PC desligado.
  O app agenda os próximos avisos (até 200 no Android, 60 no iOS) ao abrir, ao voltar para a tela e após qualquer mudança.
  - Mudanças feitas no desktop só chegam ao celular quando o app for aberto de novo.
  - Em **Conta → Lembretes da agenda** dá para ligar/desligar, sincronizar na hora e enviar um aviso de teste.
  - Android 13+ pede permissão de notificações na primeira vez.
- **Limites atuais:** no celular ainda não dá para editar/apagar itens da agenda nem definir data final de rotina.

## API usada

O app só fala com o servidor FastAPI (autenticação por Bearer token).

| Área | Rotas |
| --- | --- |
| Auth | `POST /auth/login`, `GET /auth/me` |
| Categorias | `GET/POST /finance/categories`, `PUT/DELETE /finance/categories/{id}` |
| Transações | `GET /finance/transactions?from&to&type&limit&offset`, `POST /finance/transactions`, `PUT/DELETE /finance/transactions/{id}` |
| Resumos | `GET /finance/summary?month=AAAA-MM`, `GET /finance/cashflow?start&end` (máx. 366 dias) |
| Agenda | `GET/POST /agenda` e rotas de conclusão de item |

## Rodar em desenvolvimento

Execute os comandos desta seção dentro de `mobile/` (a partir da raiz: `cd mobile`).

```bash
npm install
npm start          # abre o Expo; leia o QR code com o Expo Go (ou use um dev build)
```

- `npm run android` — emulador/celular Android conectado.
- `npm run web` — prévia no navegador (só para ver layout; notificações não existem na web, e `Alert` não funciona
  na web — por isso existe `src/utils/confirm.ts`, que usa `window.confirm` como alternativa).
- `npx tsc --noEmit` — conferir tipos.

## Conectar ao servidor

Informe o endereço do backend na tela de login, por exemplo `https://seu-backend.exemplo.app`.

- Use **HTTPS** sempre que possível (a senha trafega no login). Em builds de produção do Android, `http://` puro é bloqueado.
- Em rede local (só em casa) dá para usar `http://IP-do-PC:8000`, desde que o servidor escute na rede e o firewall permita.

## Gerar o APK

Build na nuvem com EAS (perfil `preview` = APK de distribuição interna):

```bash
npx eas-cli login
npx eas-cli build --profile preview --platform android
```

- Sem git disponível: `EAS_NO_VCS=1 npx eas-cli build --profile preview --platform android`.
- **Atualizar o app:** instale o APK novo por cima do antigo. Antes, aumente `expo.version` e `android.versionCode`
  no `app.json` (o `eas.json` usa a versão local).
- Os APKs gerados **não** vão para o repositório (estão no `.gitignore`).

## Estrutura

```
App.tsx                         componente raiz e providers
src/routes/AppRoutes.tsx         abas, overlays e botão voltar
src/services/api.ts                      cliente da API
src/hooks/useAuth.tsx                    sessão: servidor + token
src/@types/api.ts                    tipos da API
src/utils/format.ts                   formatação de moeda, datas e %
src/utils/calendarUtils.ts            lógica pura do calendário, períodos do Extrato e leitura de valores
src/utils/categoryIcons.ts            ícones de categoria (chaves antigas + emoji)
src/utils/confirm.ts                  confirmação de ações destrutivas (celular e web)
src/utils/transactionActions.ts       confirmar/apagar transação
src/services/reminders/                  lembretes agendados (expo-notifications)
src/screens/                    FinanceScreen, ExtratoScreen, BalanceDetailsScreen, NewTransactionScreen, AgendaScreen...
src/components/                 CalendarPicker, DateSheet, CategoryBadge, CategoryFormModal, NoticeBanner, TransactionRow...
```

## Decisões de projeto

- **Calendário em JS puro:** evita incompatibilidade de biblioteca nativa com Expo 57 / RN 0.86.
- **Sem `KeyboardAvoidingView`** no formulário: tela rolável com o botão Salvar no fim, funciona com ou sem edge-to-edge.
- **Gasto fixo = transações reais** geradas pelo servidor (não uma regra virtual), então aparecem em todos os relatórios.
- **Filtro do Extrato no `Main` em `src/routes/AppRoutes.tsx`:** as telas de edição desmontam as abas, então o estado fica acima delas.

## Ainda não verificado em aparelho real

Testado em tipos, lógica pura e prévia web, mas conferir no celular: botão Salvar visível com o teclado aberto,
emoji sem corte nos chips, botão voltar do Android fechando o calendário e os alertas de confirmação de exclusão.

## Ideias pausadas

- **Fechar o mês:** fechar o período e calcular o resultado do dia em que começou a anotar até o fechamento.
- **Investimentos:** registrar quanto está guardado (ex.: CDI, bolsa) e acompanhar o % de rendimento.
- Editar/apagar itens da agenda e data final de rotina no celular.
