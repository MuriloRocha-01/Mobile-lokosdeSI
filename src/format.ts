/** 1234.5 -> "R$ 1.234,50" (feito à mão: o Intl do motor JS de alguns celulares vem sem os dados do pt-BR). */
export function brl(value: number): string {
  const negative = value < 0
  const cents = Math.round(Math.abs(value) * 100)
  const reais = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const rest = (cents % 100).toString().padStart(2, '0')
  return `${negative ? '−' : ''}R$ ${reais},${rest}`
}

/** 12.5 -> "+12,5%" · -3 -> "−3,0%" · null -> "—" (sem base de comparação). Feito à mão, como `brl`. */
export function pct(value: number | null): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${Math.abs(value).toFixed(1).replace('.', ',')}%`
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Date -> "2026-09-20" (no dia do calendário do celular). */
export function toIso(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export const todayIso = (): string => toIso(new Date())

export function yesterdayIso(): string {
  const date = new Date()
  date.setDate(date.getDate() - 1)
  return toIso(date)
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-09" -> "Setembro de 2026" */
export function monthTitle(month: string): string {
  const [year, number] = month.split('-').map(Number)
  const name = MONTHS[number - 1] ?? ''
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`
}

/** "2026-09-20" -> "Hoje" | "Ontem" | "20 set" */
export function relativeDay(iso: string): string {
  if (iso === todayIso()) return 'Hoje'
  if (iso === yesterdayIso()) return 'Ontem'
  const [, month, day] = iso.split('-').map(Number)
  return `${day} ${MONTHS[month - 1].slice(0, 3)}`
}

/** "2026-09-20" -> Date à meia-noite local. */
export function fromIso(iso: string): Date {
  const [year, month, day] = iso.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function addDays(iso: string, days: number): string {
  const date = fromIso(iso)
  date.setDate(date.getDate() + days)
  return toIso(date)
}

const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

/** "Hoje", "Amanhã" ou "Seg, 22 set" (para os títulos dos dias na agenda). */
export function dayHeading(iso: string): string {
  if (iso === todayIso()) return 'Hoje'
  if (iso === addDays(todayIso(), 1)) return 'Amanhã'
  return `${WEEKDAYS_SHORT[fromIso(iso).getDay()]}, ${relativeDay(iso)}`
}
