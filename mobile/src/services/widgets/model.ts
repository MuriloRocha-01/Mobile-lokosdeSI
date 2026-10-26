import type { Transaction } from '../../@types/api'
export interface WidgetSnapshot {
  month: string
  balance: number
  income: number
  expense: number
  recent: Transaction[]
  days: { date: string; income: number; expense: number }[]
}
export type WidgetAction = { type: 'income' | 'expense' } | { date: string } | { home: true }
export function parseWidgetLink(url: string): WidgetAction | null {
  if (url === 'ecossistema://widget/income') return { type: 'income' }
  if (url === 'ecossistema://widget/expense') return { type: 'expense' }
  if (url === 'ecossistema://widget/home') return { home: true }
  const day = /^ecossistema:\/\/widget\/day\/(\d{4}-\d{2}-\d{2})$/.exec(url)?.[1]
  if (day) {
    const date = new Date(day + 'T12:00:00Z')
    if (!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day && day >= '1970-01-01' && day <= '2100-12-31') return { date: day }
  }
  return null
}
export function validSnapshot(value: any): value is WidgetSnapshot {
  return value && /^\d{4}-\d{2}$/.test(value.month) && ['balance', 'income', 'expense'].every(key => typeof value[key] === 'number' && Number.isFinite(value[key])) && Array.isArray(value.recent) && value.recent.every((t: any) => typeof t.description === 'string' && Number.isFinite(t.amount) && typeof t.date === 'string' && (t.time === null || typeof t.time === 'string')) && Array.isArray(value.days) && value.days.every((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && Number.isFinite(d.income) && Number.isFinite(d.expense))
}
