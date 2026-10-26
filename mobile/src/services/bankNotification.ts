import type { StatementRow } from './statementParser'

/** Regras conservadoras, compartilhadas pela prévia e pelo script Tasker gerado. */
export function parseBankNotification(bank: string, text: string, receivedDate: string): StatementRow {
  if (!['CAIXA', 'Nubank'].includes(bank)) throw new Error('Banco não suportado.')
  if (!text.trim() || text.length > 2000) throw new Error('Informe uma notificação de até 2.000 caracteres.')
  const normalized = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (/agendad|recusad|negad|cancelad|estorn|nao foi|nao aprovad|simulacao|tentativa|boleto|fatura|limite|saldo/.test(normalized)) throw new Error('Aviso ambíguo, recusado ou sem confirmação de movimentação. Revise manualmente.')
  const income = /pix[\s\S]{0,80}recebid|receb(?:eu|ido)[\s\S]{0,80}pix/.test(normalized)
  const expense = /compra[\s\S]{0,80}(?:aprovada|realizada)|(?:aprovada|realizada)[\s\S]{0,80}compra|acabou de fazer uma compra|pix[\s\S]{0,80}(?:enviado|realizado)|(?:enviou|transferiu)[\s\S]{0,80}pix/.test(normalized)
  if (income === expense) throw new Error('Reconhecemos apenas compra confirmada, Pix recebido ou Pix enviado com direção clara.')
  const amounts = [...text.matchAll(/R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})(?!\d)/g)]
  if (amounts.length !== 1) throw new Error('A notificação precisa ter exatamente um valor em reais (R$ 123,45).')
  const parts = amounts[0][1].replace(/\./g, '').split(',')
  const cents = Number(parts[0]) * 100 + Number(parts[1])
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 99999999999) throw new Error('Valor fora do limite de importação.')
  const explicitDates = [...text.matchAll(/\b(?:\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})\b/g)]
  if (explicitDates.length > 1) throw new Error('A notificação contém mais de uma data. Revise manualmente.')
  const rawDate = explicitDates[0]?.[0] ?? receivedDate
  const date = rawDate.includes('/') ? rawDate.split('/').reverse().join('-') : rawDate
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Data inválida.')
  const checkDate = new Date(`${date}T12:00:00Z`)
  if (!Number.isFinite(checkDate.getTime()) || checkDate.toISOString().slice(0, 10) !== date || Number(date.slice(0, 4)) < 1900 || Number(date.slice(0, 4)) > 2100) throw new Error('Data inválida.')
  const description = `${bank} · ${income ? 'Pix recebido' : /pix/.test(normalized) ? 'Pix enviado' : 'Compra no cartão'} · ${text.trim().replace(/\s+/g, ' ')}`.slice(0, 250)
  return { key: JSON.stringify([bank, date, text.trim()]), date, description, cents, type: income ? 'income' : 'expense' }
}
