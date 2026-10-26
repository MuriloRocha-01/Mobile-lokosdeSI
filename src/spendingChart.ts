import type { Cashflow } from './types'

export function spendingPoints(days: Cashflow['days'], monthly: boolean) {
  const groups = new Map<string, number>()
  for (const day of days) {
    const key = monthly ? day.date.slice(0, 7) : day.date
    groups.set(key, (groups.get(key) ?? 0) + Math.round(day.expense * 100))
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([date, cents]) => ({ date, value: cents / 100 }))
}
export function spendingPath(points: { value: number }[]) {
  const max = Math.max(1, ...points.map(p => p.value))
  return points.map((point, index) => `${index ? 'L' : 'M'}${8 + index * 284 / Math.max(1, points.length - 1)},${110 - point.value / max * 96}`).join(' ')
}
