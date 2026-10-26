import type { Transaction } from '../@types/api'

export function transactionSections(items: Transaction[], settlementDates = false) {
  const days = new Map<string, Transaction[]>()
  for (const item of items) {
    const day = settlementDates ? item.settled_at ?? item.date : item.date
    const group = days.get(day) ?? []
    group.push(item)
    days.set(day, group)
  }
  return [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, data]) => ({
    date, data: [...data].sort((a, b) => (b.time ?? '').localeCompare(a.time ?? '') || b.id - a.id),
  }))
}
