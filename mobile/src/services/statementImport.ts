import { listTransactions } from './api'
import type { Transaction } from '../@types/api'
import type { StatementRow } from './statementParser'

export async function existingForStatement(rows: StatementRow[]): Promise<Transaction[]> {
  const dates = rows.map(r => r.date).sort()
  const existing: Transaction[] = []
  let offset = 0
  while (true) {
    const page = await listTransactions({ from: dates[0], to: dates[dates.length - 1], limit: 100, offset })
    existing.push(...page.items)
    offset += page.items.length
    if (offset >= page.total) break
    if (!page.items.length || offset > 20000) throw new Error('Não consegui verificar todos os lançamentos. Importe um período menor.')
  }
  return existing
}
