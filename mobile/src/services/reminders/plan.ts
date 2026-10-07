// Decide QUANDO cada lembrete da agenda deve tocar. É uma função pura (sem o expo-notifications), para poder ser testada.

/** As linhas que o servidor devolve em GET /agenda?from&to (cada ocorrência de uma rotina já vem como uma linha). */
export interface AgendaRow {
  id: number
  title: string
  /** "2026-09-20": o dia desta ocorrência. */
  date: string
  /** "07:00"; null = o dia todo. */
  time: string | null
  status: 'pendente' | 'concluido' | 'cancelado'
  /** Avisar quantos minutos antes (0 = na hora); null = sem lembrete. */
  reminder_minutes: number | null
}

export interface PlannedReminder {
  /** Identifica o aviso (item + dia), para saber o que já foi agendado. */
  key: string
  title: string
  body: string
  at: Date
}

/** Itens sem horário avisam às 8h (do dia, ou do dia anterior se o lembrete for "1 dia antes"). */
export const ALL_DAY_HOUR = 8

/** "2026-09-20" + "07:00" -> Date no fuso do celular. */
export function localDate(day: string, time: string | null): Date {
  const [year, month, date] = day.split('-').map(Number)
  const [hour, minute] = time ? time.split(':').map(Number) : [ALL_DAY_HOUR, 0]
  return new Date(year, month - 1, date, hour, minute, 0, 0)
}

/** Quando o aviso deve tocar: o horário do item menos a antecedência do lembrete. */
export function fireTime(row: AgendaRow): Date | null {
  if (row.reminder_minutes === null) return null
  const at = localDate(row.date, row.time)
  at.setMinutes(at.getMinutes() - row.reminder_minutes)
  return at
}

/** O texto abaixo do título do aviso: "Agora · 07:00", "Em 10 min · 07:00", "Amanhã às 07:00". */
export function reminderBody(row: AgendaRow): string {
  const minutes = row.reminder_minutes ?? 0
  const when = row.time ?? 'o dia todo'
  if (minutes >= 1440) return row.time ? `Amanhã às ${row.time}` : 'Amanhã (o dia todo)'
  if (!row.time) return 'Hoje (o dia todo)'
  if (minutes === 0) return `Agora · ${when}`
  if (minutes < 60) return `Em ${minutes} min · ${when}`
  const hours = minutes / 60
  return `Em ${hours} ${hours === 1 ? 'hora' : 'horas'} · ${when}`
}

/**
 * Os próximos avisos a agendar: só itens pendentes com lembrete, no futuro, do mais próximo ao mais distante,
 * até o limite do sistema (o iOS guarda no máximo 64 avisos agendados).
 */
export function planReminders(rows: AgendaRow[], now: Date, limit: number): PlannedReminder[] {
  const planned: PlannedReminder[] = []
  for (const row of rows) {
    if (row.status !== 'pendente') continue // feito ou cancelado: não avisa
    const at = fireTime(row)
    if (!at || at.getTime() <= now.getTime() + 5_000) continue // já passou (ou passa em instantes)
    planned.push({ key: `${row.id}|${row.date}`, title: row.title, body: reminderBody(row), at })
  }
  planned.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key))
  return planned.slice(0, limit)
}
