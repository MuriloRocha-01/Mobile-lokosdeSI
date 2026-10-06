<<<<<<< HEAD
# Lokos de S.I — app de celular (Expo / React Native)

Companion do Lokos de S.I que roda no PC. Tem as abas **Finanças** (lançar um gasto na rua em poucos toques e ver o
saldo e as últimas transações) e **Agenda** (compromissos, tarefas e rotinas com lembrete). Tudo é gravado direto no
FastAPI que roda no seu PC (nada fica só no celular).

## Rodar

```bash
npm install
npm start          # abre o Expo; leia o QR code com o app Expo Go no celular
```

- `npm run android` abre num emulador/celular Android conectado.
- `npm run web` abre uma prévia no navegador (só para ver o layout; o app é feito para o celular).
- Conferir tipos: `npx tsc --noEmit`.

## Agenda e lembretes

A aba **Agenda** mostra os próximos 14 dias (compromissos, tarefas e as **rotinas** que se repetem: todo dia, dias úteis,
toda semana nos dias que você escolher, todo mês). O botão **+** cria um item com dia, hora, repetição e aviso; o círculo marca
como feito (numa rotina, só aquele dia).

Os avisos são **notificações agendadas no próprio celular** (`expo-notifications`), então chegam mesmo com o PC desligado
naquele momento e sem nenhum serviço de push. O app lê a agenda do servidor e agenda os próximos avisos (até 200 no Android,
60 no iOS) quando você abre o app, quando ele volta para a tela e depois de qualquer mudança. Consequências:

- Se você criar ou mudar algo **no desktop**, o celular só fica sabendo quando o app for aberto de novo.
- Se ficar dias sem abrir o app, os avisos já agendados continuam tocando, mas os novos só entram depois de uma abertura.
- Em **Conta → Lembretes da agenda** dá para ligar/desligar, sincronizar na hora e mandar um aviso de teste (chega em 5 s).
- No Android 13+ o sistema pede a permissão de notificações na primeira vez. Se o Expo Go não mostrar os avisos na sua versão,
  use um build de desenvolvimento (`npx expo run:android`).
- A prévia web (`npm run web`) não tem notificações.

## Conectar ao servidor

Na primeira vez o app pede **Servidor**, **e-mail** e **senha** (a mesma conta do app desktop).

- **De qualquer lugar (recomendado):** use o endereço HTTPS do Tailscale Funnel do seu PC, o mesmo que aparece na aba
  *Convidados* do desktop, por exemplo `https://desktop-xxxx.tailNNNN.ts.net`. O app do Lokos de S.I precisa estar aberto no PC.
- **Só na sua rede Wi-Fi:** `http://IP-do-PC:8000`. Isso exige que o servidor do PC escute na rede (`API_HOST=0.0.0.0`) e que
  o firewall do Windows deixe a porta 8000 passar. Sem HTTPS, a senha trafega sem criptografia (ok só em casa).
  Em builds de produção do Android, `http://` puro é bloqueado; no Expo Go funciona.

O login fica guardado no cofre do sistema (Keychain/Keystore, via `expo-secure-store`).

## Como está organizado

```
App.tsx                      abas (Finanças | Agenda | Conta) e as telas de "Novo" por cima
src/api.ts                   cliente da API (login, categorias, resumo, transações, agenda)
src/auth.tsx                 sessão: servidor + token, entra sozinho na próxima vez
src/reminders/                lembretes agendados no celular (expo-notifications)
src/screens/FinanceScreen    resumo do mês, últimas transações e o botão + gigante (FAB)
src/screens/NewTransactionScreen   Receita/Despesa, valor no teclado numérico, categorias em chips
src/screens/AgendaScreen     próximos dias, rotinas e o botão + para criar um item
src/components/Numpad        teclado numérico grande (o valor entra em centavos: 1-2-5-0 = R$ 12,50)
```

As categorias (Salário, Freelance, Alimentação...) vêm do servidor (`GET /finance/categories`). A última categoria usada
de cada tipo já vem marcada na próxima vez, para lançar com o mínimo de toques.
=======
# Mobile-lokosdeSI
>>>>>>> 42211827eaf8f6a5f65e6c85cb25fb91d1798c03
