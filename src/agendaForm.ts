// Máscaras e leitura dos campos de data e hora da tela "Novo item" (teclado numérico: só se digitam os números).

/** "0730" -> "07:30" (aceita parcial: "073" -> "07:3"). */
export function maskTime(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** "07:30" -> "07:30"; qualquer coisa fora de 00:00–23:59 -> null. */
export function parseTime(text: string): string | null {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(text) ? text : null
}

/** "20092026" -> "20/09/2026" (aceita parcial). */
export function maskDate(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 8)
  if (digits.length <= 2) return digits
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
}

/** "20/09/2026" -> "2026-09-20"; data que não existe (31/02) ou incompleta -> null. */
export function parseDate(text: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text)
  if (!match) return null
  const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  if (year < 1970 || year > 2100) return null
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** Dia da semana como o servidor numera: 0 = segunda ... 6 = domingo. */
export function weekdayOf(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number)
  return (new Date(year, month - 1, day).getDay() + 6) % 7
}
