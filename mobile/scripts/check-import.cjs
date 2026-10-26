// Teste sem rede, contas reais ou dependências adicionais.
const assert = require('node:assert/strict'); const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm'); const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file) {
  const result = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  vm.runInNewContext(code, { exports: result.exports, module: result, require, Date, Set, Map }); return result.exports;
}
const p = load('src/services/statementParser.ts'); const n = load('src/services/bankNotification.ts');
assert.equal(p.moneyCents('R$ 1.234,56', ','), 123456); assert.equal(p.moneyCents('-1,234.56', '.'), -123456);
assert.equal(p.moneyCents('(10,50)', ','), -1050); assert.throws(() => p.moneyCents('12.34,56', ',')); assert.throws(() => p.moneyCents('1.005', '.'));
assert.equal(p.statementDate('29/02/2024'), '2024-02-29'); assert.throws(() => p.statementDate('29/02/2025'));
assert.equal(p.statementDate('20261007120000[-3:BRT]'), '2026-10-07');
let table = p.readCsv('\uFEFFData;Descrição;Valor\r\n07/10/2026;"Compra; mercado";-42,90\r\n08/10/2026;"Pix ""recebido""";100,00');
let rows = p.parseCsv(table, { ...p.guessMapping(table.headers), decimal: ',' }); assert.equal(rows[0].description, 'Compra; mercado'); assert.equal(rows[0].cents, 4290); assert.equal(rows[1].type, 'income');
assert.equal(p.parseCsv(p.readCsv('date,title,amount\n2026-10-07,Loja,25.50'), { date: 0, description: 1, amount: 2, debit: -1, credit: -1, decimal: '.', card: true })[0].type, 'expense');
assert.equal(p.parseCsv(p.readCsv('Data;Descrição;Débito;Crédito\n07/10/2026;Compra;25,00;'), { date: 0, description: 1, amount: -1, debit: 2, credit: 3, decimal: ',', card: false })[0].cents, 2500);
assert.throws(() => p.readCsv('a;b\n"ab;c')); assert.throws(() => p.parseCsv(table, { ...p.guessMapping(table.headers), date: 1 }));
const ofx = 'OFXHEADER:100\n<OFX><CURDEF>BRL\n<BANKTRANLIST><STMTTRN><TRNTYPE>DEBIT\n<DTPOSTED>20261007120000[-3:BRT]\n<TRNAMT>-42.90\n<FITID>A1\n<MEMO>Compra &amp; café\n</STMTTRN></BANKTRANLIST></OFX>';
assert.equal(p.parseOfx(ofx)[0].description, 'Compra & café'); assert.equal(p.parseOfx(ofx)[0].cents, 4290);
assert.throws(() => p.parseOfx(ofx.replace('BRL', 'USD'))); assert.throws(() => p.parseOfx(ofx.replace('A1', ''))); assert.throws(() => p.parseOfx(ofx.replace('</BANKTRANLIST>', '<STMTTRN><FITID>A1</STMTTRN></BANKTRANLIST>')));
assert.equal(p.possibleDuplicates([rows[0], { ...rows[0], key: 'second' }], [{ ...rows[0], amount: 42.9 }]).size, 1);
for (const bank of ['CAIXA', 'Nubank']) {
  assert.equal(n.parseBankNotification(bank, 'Compra aprovada de R$ 50,00', '2026-10-07').type, 'expense');
  assert.equal(n.parseBankNotification(bank, 'Pix recebido de R$ 1.234,56', '2026-10-07').cents, 123456);
  assert.equal(n.parseBankNotification(bank, 'Pix enviado de R$ 10,00', '2026-10-07').type, 'expense');
  for (const text of ['Compra recusada de R$ 50,00', 'Pix agendado de R$ 50,00', 'Saldo de R$ 50,00', 'Pix recebido R$ 50,00 e saldo R$ 100,00', 'Pix recebido R$ 0,00', 'Compra aprovada R$ 12.34,56', 'Compra aprovada R$ 50,00 em 31/02/2026']) assert.throws(() => n.parseBankNotification(bank, text, '2026-10-07'));
}
const locals = { mode: 'preview', bank: 'Nubank', text: 'Compra aprovada de R$ 50,00', expense_category: '1', income_category: '2' }; const globals = {};
const context = { local: key => locals[key] ?? '', setLocal: (key, val) => locals[key] = val, global: key => globals[key] ?? '', setGlobal: (key, val) => globals[key] = val, Date };
const script = require('./tasker-script.cjs')(n.parseBankNotification); vm.runInNewContext(script, context);
assert.equal(locals.lokos_error, ''); assert.equal(locals.lokos_body, ''); assert.equal(JSON.parse(locals.lokos_preview).amount, 50); assert.equal(globals.LokosHistory, undefined);
locals.mode = 'send'; vm.runInNewContext(script, context); assert.equal(JSON.parse(locals.lokos_body).category_id, 1); assert.equal(JSON.parse(globals.LokosHistory)[0].state, 'pending');
vm.runInNewContext(script, context); assert.match(locals.lokos_error, /repetida/); assert.equal(locals.lokos_body, '');
locals.mode = 'confirm'; locals.http_response_code = '201'; vm.runInNewContext(script, context); assert.equal(JSON.parse(globals.LokosHistory)[0].state, 'saved');
const embedded = '// Gerado por scripts/check-import.cjs --write-tasker. Não editar manualmente.\nexport const TASKER_SCRIPT = ' + JSON.stringify(script) + '\n';
if (process.argv.includes('--write-tasker')) {
  fs.mkdirSync(path.join(root, 'automation'), { recursive: true }); fs.writeFileSync(path.join(root, 'automation/tasker-notifications.js'), script + '\n');
  fs.writeFileSync(path.join(root, 'src/config/taskerScript.ts'), embedded);
}
assert.equal(fs.readFileSync(path.join(root, 'automation/tasker-notifications.js'), 'utf8'), script + '\n');
assert.equal(fs.readFileSync(path.join(root, 'src/config/taskerScript.ts'), 'utf8'), embedded);
console.log('OFX, CSV, centavos, datas, duplicados e fluxo Tasker: OK.');
