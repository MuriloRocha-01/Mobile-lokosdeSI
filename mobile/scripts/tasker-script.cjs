// Gerador executado apenas no Node; Hermes não preserva Function.toString().
module.exports = function taskerScript(parseBankNotification) {
  return `// Lokos de S.I — Tasker JavaScript, Auto Exit ligado.
// Variáveis locais: bank, text, expense_category, income_category, mode.
var parseBankNotification = (${parseBankNotification.toString()});
(function () {
  setLocal('lokos_body', ''); setLocal('lokos_error', ''); setLocal('lokos_key', ''); setLocal('lokos_preview', '');
  try {
    var history = JSON.parse(global('LokosHistory') || '[]');
    if (!Array.isArray(history)) throw new Error('Histórico Tasker inválido. Revise antes de limpar.');
    if (local('mode') === 'confirm') {
      var code = Number(local('http_response_code'));
      // A reserva permanece após falha/timeout: nunca reenviar automaticamente.
      var pendingKey = global('LokosPendingKey');
      history = history.map(function (entry) { if (entry.key === pendingKey && (code === 200 || code === 201)) entry.state = 'saved'; return entry; });
      setGlobal('LokosHistory', JSON.stringify(history));
      if (code !== 200 && code !== 201) throw new Error('Resposta incerta. Confira o extrato antes de tentar novamente.');
      return;
    }
    var today = new Date();
    var day = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    var item = parseBankNotification(local('bank'), local('text'), day);
    var category = Number(local(item.type === 'income' ? 'income_category' : 'expense_category'));
    if (!Number.isSafeInteger(category) || category <= 0) throw new Error('Configure uma categoria válida para este tipo.');
    if (history.some(function (entry) { return entry.key === item.key; })) throw new Error('Mensagem repetida ou envio pendente. Confira o extrato.');
    if (history.length >= 500) throw new Error('Histórico cheio. Arquive e limpe somente após conferir os lançamentos.');
    var body = JSON.stringify({ description: item.description, amount: item.cents / 100, date: item.date, type: item.type, category_id: category, recurrence: 'none' });
    // Teste primeiro: mode=preview não reserva nem autoriza o POST.
    if (local('mode') !== 'send') { setLocal('lokos_preview', body); return; }
    history.push({ key: item.key, state: 'pending' });
    setGlobal('LokosHistory', JSON.stringify(history)); setGlobal('LokosPendingKey', item.key);
    setLocal('lokos_key', item.key); setLocal('lokos_body', body);
  } catch (error) { setLocal('lokos_error', error.message); }
})();`
}
