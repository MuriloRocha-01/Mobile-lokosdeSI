import type { TransactionType } from '../@types/api'

export const MAX_STATEMENT_BYTES = 2 * 1024 * 1024
export const MAX_STATEMENT_ROWS = 1000
export interface StatementRow { key: string; date: string; description: string; cents: number; type: TransactionType }
export interface CsvTable { headers: string[]; rows: string[][] }
export interface CsvMapping { date: number; description: number; amount: number; debit: number; credit: number; decimal: ',' | '.'; card: boolean }

export function moneyCents(input: string, decimal: ',' | '.'): number {
  let value = input.trim().replace(/^R\$\s*/i, '').replace(/\s/g, '')
  const negative = value.startsWith('-') || /^\(.*\)$/.test(value)
  value = value.replace(/^[+-]/, '').replace(/^\((.*)\)$/, '$1')
  const group = decimal === ',' ? '.' : ','
  const escaped = group === '.' ? '\\.' : ','
  const dec = decimal === '.' ? '\\.' : ','
  if (!new RegExp(`^(?:\\d+|\\d{1,3}(?:${escaped}\\d{3})+)(?:${dec}\\d{1,2})?$`).test(value)) throw new Error(`Valor inválido: ${input}`)
  const [whole, fraction = ''] = value.split(group).join('').split(decimal)
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  if (!Number.isSafeInteger(cents) || cents > 99999999999) throw new Error('Valor fora do limite de importação.')
  return negative ? -cents : cents
}

export function statementDate(input: string): string {
  const text = input.trim()
  let year: number, month: number, day: number
  let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  if (match) [, year, month, day] = match.map(Number)
  else if ((match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text))) [, day, month, year] = match.map(Number)
  else if ((match = /^(\d{4})(\d{2})(\d{2})(?:\d{6}(?:\.\d+)?(?:\[[^\]]+\])?)?$/.exec(text))) [, year, month, day] = match.map(Number)
  else throw new Error(`Data inválida: ${input}. Use DD/MM/AAAA ou AAAA-MM-DD.`)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  if (year! < 1900 || year! > 2100 || date.getUTCFullYear() !== year! || date.getUTCMonth() !== month! - 1 || date.getUTCDate() !== day!) throw new Error(`Data inválida: ${input}`)
  return `${year!}-${String(month!).padStart(2, '0')}-${String(day!).padStart(2, '0')}`
}

function row(key: string, date: string, description: string, amount: number): StatementRow {
  description = description.replace(/\s+/g, ' ').trim()
  if (!description || description.length > 250) throw new Error('A descrição deve ter entre 1 e 250 caracteres.')
  if (!amount) throw new Error('Lançamento com valor zero. Remova a linha antes de importar.')
  return { key, date: statementDate(date), description, cents: Math.abs(amount), type: amount < 0 ? 'expense' : 'income' }
}

export function readCsv(content: string): CsvTable {
  const text = content.replace(/^\uFEFF/, '').replace(/^sep=([;,\t])\r?\n/i, '')
  const first = text.split(/\r?\n/)[0]
  const delimiter = [';', ',', '\t'].sort((a, b) => first.split(b).length - first.split(a).length)[0]
  const lines: string[][] = []; let cells: string[] = []; let cell = ''; let quoted = false; let closed = false
  const push = () => { cells.push(cell.trim()); cell = ''; closed = false }
  const end = () => { push(); if (cells.some(Boolean)) lines.push(cells); cells = [] }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') { cell += '"'; i++ }
      else if (char === '"') { quoted = false; closed = true }
      else cell += char
    } else if (char === '"' && !cell.trim() && !closed) quoted = true
    else if (char === delimiter) push()
    else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; end() }
    else if (closed && char.trim()) throw new Error('CSV inválido: texto depois de aspas fechadas.')
    else if (char === '"') throw new Error('CSV inválido: aspas no meio de um campo.')
    else cell += char
  }
  if (quoted) throw new Error('CSV inválido: campo com aspas não fechado.')
  if (cell || cells.length) end()
  const headers = lines.shift() ?? []
  if (headers.length < 2 || !lines.length) throw new Error('O CSV precisa de um cabeçalho e lançamentos.')
  if (lines.length > MAX_STATEMENT_ROWS) throw new Error('Importe até 1.000 lançamentos por arquivo.')
  if (lines.some(line => line.length !== headers.length)) throw new Error('CSV com número de colunas inconsistente. Confira o separador e as aspas.')
  return { headers, rows: lines }
}

export function guessMapping(headers: string[]): CsvMapping {
  const names = headers.map(h => h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase())
  const find = (keys: string[]) => names.findIndex(h => keys.includes(h))
  return { date: find(['data', 'date', 'data lancamento']), description: find(['descricao', 'description', 'title', 'historico', 'lancamento']), amount: find(['valor', 'amount']), debit: find(['debito', 'debit']), credit: find(['credito', 'credit']), decimal: ',', card: false }
}

export function parseCsv(table: CsvTable, map: CsvMapping): StatementRow[] {
  const indices = map.amount >= 0 ? [map.date, map.description, map.amount] : [map.date, map.description, map.debit, map.credit]
  if (indices.some(i => i < 0 || i >= table.headers.length) || new Set(indices).size !== indices.length) throw new Error('Escolha colunas diferentes para data, descrição e valor (ou débito/crédito).')
  return table.rows.map((cells, index) => {
    try {
      let amount: number
      if (map.amount >= 0) amount = moneyCents(cells[map.amount], map.decimal) * (map.card ? -1 : 1)
      else {
        const debit = cells[map.debit] ? moneyCents(cells[map.debit], map.decimal) : 0
        const credit = cells[map.credit] ? moneyCents(cells[map.credit], map.decimal) : 0
        if (debit < 0 || credit < 0 || (debit && credit)) throw new Error('Débito/crédito devem ser positivos, com apenas um lado preenchido.')
        amount = credit - debit
      }
      return row(`csv:${index}`, cells[map.date], cells[map.description], amount)
    } catch (error) { throw new Error(`Linha ${index + 2}: ${(error as Error).message}`) }
  })
}

function ofxValue(block: string, tag: string): string {
  const value = new RegExp(`<${tag}\\s*>([^<]*)`, 'i').exec(block)?.[1]?.trim() ?? ''
  return value.replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, entity: string) => {
    if (entity[0] === '#') { const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)); return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '' }
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[entity.toLowerCase()]
  })
}

export function parseOfx(content: string): StatementRow[] {
  if (!/<OFX[\s>]/i.test(content)) throw new Error('O arquivo não contém um extrato OFX válido.')
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) throw new Error('OFX com entidades externas não é aceito.')
  const currencies = [...content.matchAll(/<CURDEF\s*>([^<\r\n]+)/gi)].map(m => m[1].trim().toUpperCase())
  if (!currencies.length || currencies.some(c => c !== 'BRL')) throw new Error('A importação aceita somente extratos em BRL (reais).')
  if (/<CORRECTFITID\s*>/i.test(content)) throw new Error('OFX com correções: revise os lançamentos no banco antes de importar.')
  const blocks = [...content.matchAll(/<STMTTRN\s*>([\s\S]*?)<\/STMTTRN\s*>/gi)]
  if (!blocks.length || blocks.length !== (content.match(/<STMTTRN\s*>/gi) ?? []).length) throw new Error('OFX sem lançamentos ou com registros incompletos.')
  if (blocks.length > MAX_STATEMENT_ROWS) throw new Error('Importe até 1.000 lançamentos por arquivo.')
  const ids = new Set<string>()
  return blocks.map((match, index) => {
    const block = match[1]; const id = ofxValue(block, 'FITID')
    if (!id || ids.has(id)) throw new Error(`Registro ${index + 1}: identificador FITID ausente ou repetido.`)
    ids.add(id)
    try { return row(`ofx:${id}`, ofxValue(block, 'DTPOSTED'), ofxValue(block, 'MEMO') || ofxValue(block, 'NAME'), moneyCents(ofxValue(block, 'TRNAMT'), '.')) }
    catch (error) { throw new Error(`Registro ${index + 1}: ${(error as Error).message}`) }
  })
}

export function transactionFingerprint(item: { date: string; description: string; type: TransactionType; cents: number }): string {
  return JSON.stringify([item.date, item.type, item.cents, item.description.trim().replace(/\s+/g, ' ').toLowerCase()])
}

/** Parecidos são candidatos à revisão, não prova de duplicação. */
export function possibleDuplicates(rows: StatementRow[], existing: { date: string; description: string; type: TransactionType; amount: number }[]): Set<string> {
  const counts = new Map<string, number>()
  for (const item of existing) { const key = transactionFingerprint({ ...item, cents: Math.round(item.amount * 100) }); counts.set(key, (counts.get(key) ?? 0) + 1) }
  const result = new Set<string>()
  for (const item of rows) { const key = transactionFingerprint(item); const count = counts.get(key) ?? 0; if (count) { result.add(item.key); counts.set(key, count - 1) } }
  return result
}
