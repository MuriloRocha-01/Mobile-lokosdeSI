# Lokos de S.I — app de celular (Expo / React Native)

Companion Android do **Lokos de S.I**. Usa a **mesma conta e o mesmo servidor** do app desktop: tudo o que você lança no
celular aparece no PC e vice-versa (nada fica só no aparelho).

- Expo SDK 57 · React Native 0.86 · TypeScript
- Versão atual: **1.1.0** (`versionCode` 2)
- O calendário é feito em JS puro (sem biblioteca nativa de datas), para não depender de módulos nativos.

## Funcionalidades

O app tem 4 abas: **Finanças · Extrato · Agenda · Conta**.

### Login e conta
- Na primeira vez pede **Servidor**, **e-mail** e **senha** (a mesma conta do desktop).
- A sessão fica no cofre do sistema (`expo-secure-store`); nas próximas vezes entra sozinho.
- Aba **Conta**: dados do usuário, sair, e configuração dos lembretes da agenda.

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

```bash
npm install
npm start          # abre o Expo; leia o QR code com o Expo Go (ou use um dev build)
```

- `npm run android` — emulador/celular Android conectado.
- `npm run web` — prévia no navegador (só para ver layout; notificações não existem na web, e `Alert` não funciona
  na web — por isso existe `src/confirm.ts`, que usa `window.confirm` como alternativa).
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
App.tsx                         abas (Finanças | Extrato | Agenda | Conta), overlays e botão voltar
src/api.ts                      cliente da API
src/auth.tsx                    sessão: servidor + token
src/types.ts                    tipos da API
src/format.ts                   formatação de moeda, datas e %
src/calendarUtils.ts            lógica pura do calendário, períodos do Extrato e leitura de valores
src/categoryIcons.ts            ícones de categoria (chaves antigas + emoji)
src/confirm.ts                  confirmação de ações destrutivas (celular e web)
src/transactionActions.ts       confirmar/apagar transação
src/reminders/                  lembretes agendados (expo-notifications)
src/screens/                    FinanceScreen, ExtratoScreen, BalanceDetailsScreen, NewTransactionScreen, AgendaScreen...
src/components/                 CalendarPicker, DateSheet, CategoryBadge, CategoryFormModal, NoticeBanner, TransactionRow...
```

## Decisões de projeto

- **Calendário em JS puro:** evita incompatibilidade de biblioteca nativa com Expo 57 / RN 0.86.
- **Sem `KeyboardAvoidingView`** no formulário: tela rolável com o botão Salvar no fim, funciona com ou sem edge-to-edge.
- **Gasto fixo = transações reais** geradas pelo servidor (não uma regra virtual), então aparecem em todos os relatórios.
- **Filtro do Extrato no `Main`:** as telas de edição desmontam as abas, então o estado fica acima delas.

## Ainda não verificado em aparelho real

Testado em tipos, lógica pura e prévia web, mas conferir no celular: botão Salvar visível com o teclado aberto,
emoji sem corte nos chips, botão voltar do Android fechando o calendário e os alertas de confirmação de exclusão.

## Ideias pausadas

- **Fechar o mês:** fechar o período e calcular o resultado do dia em que começou a anotar até o fechamento.
- **Investimentos:** registrar quanto está guardado (ex.: CDI, bolsa) e acompanhar o % de rendimento.
- Editar/apagar itens da agenda e data final de rotina no celular.
