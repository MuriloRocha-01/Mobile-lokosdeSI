// Lógica pura (sem React Native) do calendário, do período do Extrato e do valor digitado no teclado padrão.
// Fica separada das telas para poder ser testada de verdade em Node.
import { addDays, fromIso } from './format'
import type { TransactionType } from '../@types/api'

export const MONTH_NAMES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const WEEKDAY_INITIALS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'] // a semana começa no domingo, como no calendário do celular

/** O servidor só aceita datas entre 1970 e 2100 (`_check_date`). */
export const MIN_DATE = '1970-01-01'
export const MAX_DATE = '2100-12-31'
/** `/finance/cashflow` recusa períodos maiores que isso. */
export const MAX_RANGE_DAYS = 366

const pad = (n: number) => String(n).padStart(2, '0')

/** Monta "2026-09-05" sem passar por Date/UTC (nada de `toISOString()`: o fuso empurra o dia). */
export const isoOf = (year: number, month0: number, day: number): string => `${String(year).padStart(4, '0')}-${pad(month0 + 1)}-${pad(day)}`

/** "2026-09-05" -> "05/09/2026" */
export function dateBr(iso: string): string {
  const [year, month, day] = iso.split('-')
  return `${day}/${month}/${year}`
}

/** "2026-09-05" -> "05/09" */
export function dateShort(iso: string): string {
  const [, month, day] = iso.split('-')
  return `${day}/${month}`
}

/** Quantos dias há de `a` até `b` (b - a). `Math.round` porque dia de horário de verão tem 23 ou 25 horas. */
export function daysBetween(a: string, b: string): number {
  return Math.round((fromIso(b).getTime() - fromIso(a).getTime()) / 86_400_000)
}

/**
 * Os dias de um mês em 6 linhas × 7 colunas (domingo primeiro), com `null` nos buracos. Sempre 6 linhas, para a
 * altura do calendário não pular de um mês para o outro.
 */
export function monthGrid(year: number, month0: number): (string | null)[][] {
  const lead = new Date(year, month0, 1).getDay() // 0 = domingo
  const days = new Date(year, month0 + 1, 0).getDate() // dia 0 do mês seguinte = último dia deste
  const cells: (string | null)[] = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let day = 1; day <= days; day++) cells.push(isoOf(year, month0, day))
  while (cells.length < 42) cells.push(null)
  return Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7))
}

/** Anda `delta` meses (nunca `setMonth(+1)` num dia 29–31: 31/01 viraria 03/03). */
export function shiftMonth(year: number, month0: number, delta: number): { year: number; month0: number } {
  const total = year * 12 + month0 + delta
  return { year: Math.floor(total / 12), month0: ((total % 12) + 12) % 12 }
}

// ------------------------------------------------------------------ escolha de um período no calendário

export interface RangeSel {
  start: string | null
  end: string | null
}

/**
 * O que um toque num dia faz na escolha de um período: sem início (ou com o período já completo) recomeça;
 * com só o início, fecha o período (se o toque for ANTES do início, os dois se trocam; no mesmo dia vale um
 * dia só). Passou de `maxDays`: mantém o que estava e devolve o aviso.
 */
export function nextRange(sel: RangeSel, tapped: string, maxDays: number = MAX_RANGE_DAYS): { sel: RangeSel; error?: string } {
  if (!sel.start || sel.end) return { sel: { start: tapped, end: null } }
  const [start, end] = tapped < sel.start ? [tapped, sel.start] : [sel.start, tapped]
  if (daysBetween(start, end) + 1 > maxDays) return { sel, error: `O período pode ter no máximo ${maxDays} dias.` }
  return { sel: { start, end } }
}

// ------------------------------------------------------------------ filtro do Extrato

export type ExtratoType = 'all' | TransactionType
export type ExtratoPeriod = 'month' | 'lastMonth' | '30d' | 'year' | 'custom'

export interface ExtratoFilter {
  type: ExtratoType
  period: ExtratoPeriod
  /** Só em `period: 'custom'`. */
  from?: string
  to?: string
}

export const DEFAULT_EXTRATO: ExtratoFilter = { type: 'all', period: 'month' }

/** De/até (inclusive) de um filtro, a partir do dia de hoje. */
export function resolvePeriod(filter: ExtratoFilter, today: string): { from: string; to: string } {
  const [year, month] = today.split('-').map(Number)
  const month0 = month - 1
  if (filter.period === 'lastMonth') {
    const lastDay = new Date(year, month0, 0) // dia 0 = último dia do mês anterior (janeiro dá dezembro)
    return { from: isoOf(lastDay.getFullYear(), lastDay.getMonth(), 1), to: isoOf(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate()) }
  }
  if (filter.period === '30d') return { from: addDays(today, -29), to: today }
  if (filter.period === 'year') return { from: isoOf(year, 0, 1), to: isoOf(year, 11, 31) }
  if (filter.period === 'custom' && filter.from && filter.to) return { from: filter.from, to: filter.to }
  return { from: isoOf(year, month0, 1), to: isoOf(year, month0, new Date(year, month0 + 1, 0).getDate()) }
}

// ------------------------------------------------------------------ valor digitado no teclado padrão

/**
 * Lê o que a pessoa digitou no campo de valor: "12,50", "12.50", "1.234,56", "R$ 5". Devolve null se não for
 * um valor válido (vazio, letras, mais de 9 dígitos inteiros, mais de 2 casas decimais).
 *  - com "," e "." juntos, o ÚLTIMO é o decimal e o outro é separador de milhar ("1.234,56", "1,234.56");
 *  - só ",": sempre decimal;
 *  - só ".": vários pontos = milhar ("1.234.567"); um ponto com 3 dígitos depois = milhar ("1.234" = 1234);
 *    um ponto com 1–2 dígitos depois = decimal ("12.5").
 * O valor sai de texto (`"12.50"`), nunca de conta com ponto flutuante.
 */
export function parseAmountText(raw: string): number | null {
  const text = raw.replace(/R\$/gi, '').replace(/\s/g, '')
  if (!text || !/^[0-9.,]+$/.test(text)) return null

  const lastComma = text.lastIndexOf(',')
  const lastDot = text.lastIndexOf('.')
  let integer: string
  let decimal = ''

  if (lastComma !== -1 && lastDot !== -1) {
    const at = Math.max(lastComma, lastDot)
    const decimalSeparator = text[at]
    integer = text.slice(0, at)
    decimal = text.slice(at + 1)
    if (integer.includes(decimalSeparator)) return null
    if (/[.,]/.test(integer) && !/^\d{1,3}([.,]\d{3})+$/.test(integer)) return null // milhar mal agrupado
    integer = integer.replace(/[.,]/g, '')
  } else if (lastComma !== -1) {
    if (text.indexOf(',') !== lastComma) return null
    integer = text.slice(0, lastComma)
    decimal = text.slice(lastComma + 1)
  } else if (lastDot !== -1) {
    const groups = text.split('.')
    if (groups.length > 2) {
      if (!groups.slice(1).every((group) => group.length === 3) || groups[0].length === 0) return null
      integer = groups.join('')
    } else {
      const after = groups[1]
      if (after.length === 3 && groups[0] !== '0' && groups[0] !== '') {
        integer = groups.join('') // "1.234" = mil duzentos e trinta e quatro
      } else {
        integer = groups[0]
        decimal = after
      }
    }
  } else {
    integer = text
  }

  if (decimal.length > 2) return null
  integer = integer.replace(/^0+(?=\d)/, '')
  if (integer === '') integer = '0'
  if (integer.length > 9) return null
  return Number(`${integer}.${decimal.padEnd(2, '0')}`)
}
