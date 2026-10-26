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

---

# Histórico de funcionalidades e operação

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


## Perfil, cartões e ciclos

O cadastro abre um questionário com nome, foto opcional, dias de recebimento/contas/ciclo e cartão opcional. O perfil e os cartões ficam no backend. O início de ciclo muda apenas o período dos relatórios: não apaga dívidas, transações ou saldo acumulado. Os dias 29–31 usam o último dia em meses menores.

Receitas somam e despesas subtraem do cartão informado. Dinheiro não tem cartão; Pix pode ter. Crédito, débito e vale-alimentação exigem cartão. Trata-se do saldo dos registros, sem conexão bancária ou pagamento real de faturas. Lançamentos antigos continuam sem método/cartão até serem editados.

## Ativação no servidor e atualizações Android

Backend alterado: pasta `backend/` deste repositório. Instale requirements.txt no ambiente do servidor e reinicie o backend para carregar as rotas e a migração aditiva. Faça o backup habitual do banco antes de atualizar o servidor. O aplicativo precisa desse backend atualizado para concluir o perfil.

Esta versão requer um novo APK (novos módulos nativos). Instale primeiro o build 3, versão 1.2.0, com a mesma assinatura dos APKs anteriores. Builds antigos sem o verificador precisam dessa primeira instalação manual.

Para lançamentos seguintes, aumente version/versionCode no app.json, gere o APK com o mesmo perfil e assinatura e publique no UPDATES_ROOT do servidor:

~~~powershell
& ./publish-mobile-update.ps1 -Apk C:/caminho/app.apk -UpdatesRoot F:/Atualizacoes -Version 1.3.0 -BuildNumber 4
~~~

Substitua os caminhos pelo APK e UPDATES_ROOT reais. Por padrão MinimumBuild é o build publicado: versões anteriores ficam bloqueadas ao consultar /updates/mobile/manifest. O app baixa automaticamente via HTTPS, verifica MD5 contra corrupção e pede a confirmação de instalação do Android. O sistema pode exigir autorização para instalar apps desta origem. Nunca desinstale o aplicativo para atualizar. O APK deve manter a assinatura e o identificador originais.

Uma exigência já recebida fica guardada e continua bloqueando offline. Sem conexão, não é possível descobrir uma exigência ainda não recebida. A verificação está desativada no Expo Go/desenvolvimento e web; o fluxo APK é exclusivo de Android. Para distribuição pela Play Store, substituir esse instalador pelo fluxo da loja.

Correções JS/assets compatíveis usam EAS Update (canal preview ou production do build). Publique com npx eas-cli update --channel preview --message "Descrição da correção"; o Expo consulta e aplica atualizações compatíveis ao iniciar. Mudanças nativas exigem novo APK. Nenhuma atualização foi publicada automaticamente por estas alterações.

Lembretes são locais, agendados para os próximos 45 dias e renovados ao abrir o app. Sem abrir por mais tempo, novos avisos precisam de sincronização. Ao sair da conta, os avisos agendados são removidos. A entrega depende da permissão e das restrições de bateria do sistema.

Validação: node tests/finance.cjs; npx tsc --noEmit; no backend (pasta `backend/`), python tests/test_mobile.py usa somente banco temporário.


### Widgets Android

Em Conta, use Adicionar resumo financeiro ou Adicionar agenda do mês. Também é possível adicionar pelo menu Widgets do launcher. O resumo mostra o saldo acumulado até hoje e as cinco últimas despesas do mês; a agenda mostra receitas e despesas por dia (dias futuros são previstos). Os atalhos abrem o cadastro e os dias abrem o extrato filtrado. O horário dos lançamentos é opcional; registros antigos não recebem horário inventado.

Os widgets consultam `/finance/widget?today=YYYY-MM-DD` com a sessão guardada no SecureStore. Atualizam ao abrir o app, alterar lançamentos, tocar em Atualizar e pelo agendamento Android de 30 minutos (sujeito à bateria). Falhas exibem uma mensagem sem manter valores antigos; sair da conta limpa os widgets. Exigem novo APK com o módulo nativo, não funcionam no Expo Go ou na web.

Verificações: `npx tsc --noEmit`, `node tests/finance.cjs`, `node tests/widgets.cjs`, `npx expo prebuild --platform android --no-install`. O teste de widgets usa os componentes e o renderizador reais da biblioteca; tamanho, fonte, cliques e atualização em segundo plano ainda precisam ser conferidos no aparelho.


### Validação da interface no MSI (17/10/2026)

Interface clara com perfil, categorias, gráfico mensal/seis meses/período, extrato e últimas transações agrupados por dia. Gráfico usa react-native-svg na versão compatível com SDK 57. Nenhuma build EAS foi gerada nesta etapa.

Testado no MSI App Player via Expo Go 57.0.9 com Metro local: login, painel, filtros de 11 a 13/10, calendário de lançamento, data preservada ao mudar para receita e gráfico com total igual ao extrato. Testado também com densidade temporária de 400 dpi (largura de 360 dp), depois restaurada para os 240 dpi originais. Não foram salvos ou excluídos lançamentos durante a conferência. Corrigidos no teste: carregamento de notificações incompatíveis com Expo Go, espaço vazio no calendário, primeiro toque com campo focado e alinhamento do gráfico.

Para repetir: ativar ADB no MSI, executar `npx expo start --go --lan --port 8081`, usar o HD-Adb do MSI para `reverse tcp:8081 tcp:8081` e abrir `exp://127.0.0.1:8081` no Expo Go. O endereço localhost do Metro pode escutar só em IPv6 no Windows; o modo LAN aceita o encaminhamento IPv4 do ADB. Notificações e widgets nativos ficam fora dessa verificação no Expo Go e exigem APK próprio. Não publicar nem gerar nova build sem solicitação do usuário.

## Planejamento financeiro

No painel, **Planejamento** abre previsão de seis meses, limites mensais por categoria e faturas de crédito. Limites são salvos por conta no backend e se repetem mensalmente. Faturas usam fechamento/vencimento configuráveis; compras no dia do fechamento entram na fatura que fecha naquele dia. Débito, Pix e dinheiro não entram nas faturas.

A previsão é uma estimativa dos registros e recorrências, não uma confirmação bancária de pagamento. O primeiro mês considera movimentos após hoje; o saldo projetado acumula os meses anteriores. Repetições futuras são calculadas em memória. Cartões sem ciclo configurado usam a data do lançamento. Configurar/alterar um ciclo recalcula as estimativas.

Em **Nova transação → Despesa → Compra parcelada**, informe o preço à vista, quantidade e data da primeira parcela. Opcionalmente informe o valor real cobrado por parcela, já com juros; o app mostra total e acréscimo (não infere taxa de juros). Sem juros, o resto da divisão em centavos vai nas primeiras parcelas. Todas são gravadas em uma única transação de banco. No crédito, a primeira data precisa coincidir com o vencimento configurado. Editar ou excluir uma parcela afeta somente ela.

**Detalhes → Excluir despesa/receita** pede confirmação. Excluir a origem de uma repetição encerra as próximas repetições, preservando as ocorrências existentes. Ocorrências recorrentes excluídas não são recriadas.

Validação local: `npx tsc --noEmit`, `node tests/planning.cjs`, `node tests/finance.cjs`, `node tests/widgets.cjs`; backend: `.test-venv/Scripts/python.exe tests/test_planning.py` (banco temporário). A conferência visual no MSI desta alteração aguarda o usuário liberar o emulador. Exportação JavaScript local não gera APK e não envia build ao EAS.


### Contas, assinaturas e metas

Planejamento agora inclui **Contas**, **Assinaturas** e **Metas**. O extrato filtra pendentes ou pagas/recebidas; detalhes permitem confirmar a baixa hoje ou voltar para pendente. O formulário permite escolher a situação. Saldo, gráficos e cartões contam somente baixas confirmadas, pela data da baixa. No filtro de pagas/recebidas, o extrato também usa essa data; nas demais situações usa a data prevista/do lançamento. Alterar a data prevista de um registro já pago preserva a data da baixa.

Novas parcelas e ocorrências recorrentes ficam pendentes. Vencidas continuam na previsão do mês atual até a confirmação. Assinaturas mostram equivalentes mensais/anuais (não são cobrança adicional); encerrar a repetição preserva registros existentes e não cancela o contrato no fornecedor.

Metas guardam nome, alvo e total reservado. Reservar ou liberar não cria transações; o painel separa saldo realizado, reservado e livre. A reserva nova é limitada ao saldo livre com verificação serializada no SQLite. Se despesas posteriores reduzirem o saldo abaixo das reservas, o app mostra o saldo livre negativo e permite reduzir a reserva. Excluir uma meta libera sua reserva.

A migração faz backup do SQLite antes de adicionar status/data de baixa; registros antigos até o dia da migração são preservados como realizados e os futuros ficam pendentes. Novas baixas usam o dia local de São Paulo. Testes adicionais: `tests/test_management.py` no backend (baixa/reversão, adiantamento, isolamento, reservas concorrentes, recorrências concorrentes e migração).


### Sessão persistente no celular

O app renova o acesso de 24 horas usando uma credencial de sessão guardada no SecureStore. O backend guarda somente o SHA-256 dessa credencial, vinculado à conta e ao hash da senha. A validade da sessão é de 180 dias desde a última renovação. Logout revoga a renovação no servidor quando há conexão e remove os dados locais mesmo offline; o token de acesso já emitido continua sujeito à validade original. Troca de senha invalida a renovação.

Requisições simultâneas compartilham uma renovação; só uma resposta 401 permite repetir a solicitação, uma vez. Falhas de rede/servidor preservam a sessão. Uma renovação atrasada não restaura um login encerrado. Tokens antigos ainda válidos são migrados ao abrir o novo app; tokens antigos já expirados exigem um último login. Não se armazena a senha.

Validação: `node tests/session.cjs`, `npx tsc --noEmit`, exportação Android local; backend `tests/test_sessions.py` em banco temporário.
