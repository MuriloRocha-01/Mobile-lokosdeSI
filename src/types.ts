// Formatos que a API do Lokos de S.I (FastAPI no PC) devolve. Os mesmos do app desktop.

export type TransactionType = 'income' | 'expense'

export interface AuthUser {
  id: number
  name: string
  email: string
  is_admin: boolean
}

export interface AuthResult {
  access_token: string
  user: AuthUser
}

export interface TransactionCategory {
  id: number
  name: string
  type: TransactionType
  /** Nome "de significado" ("food", "salary"...) — cada app desenha o seu ícone — ou um emoji, nas categorias criadas pela pessoa. */
  icon: string
  /** "#rrggbb" */
  color: string
  is_default: boolean
}

/** Repetição de uma transação (conta fixa, assinatura...): sem diária/semanal — não fazem sentido pra dinheiro. */
export type TransactionRecurrence = 'none' | 'monthly' | 'yearly'

export interface Transaction {
  id: number
  description: string
  amount: number
  /** "2026-09-20" */
  date: string
  type: TransactionType
  category_id: number
  category: TransactionCategory
  recurrence: TransactionRecurrence
  recurrence_until: string | null
  /** Preenchido só nas ocorrências lançadas automaticamente: aponta para a transação-âncora da série. */
  recurrence_parent_id: number | null
}

export interface TransactionPage {
  items: Transaction[]
  total: number
}

/** Uma fatia das despesas do mês (por categoria). */
export interface CategoryShare {
  category_id: number
  name: string
  icon: string
  color: string
  total: number
  /** % do total de despesas do mês. */
  percent: number
}

export interface PeriodTotals {
  income: number
  expense: number
  balance: number
}

export interface FinanceSummary {
  month: string
  income: number
  expense: number
  month_balance: number
  /** Saldo ACUMULADO de tudo até o fim do mês (inclui lançamentos de datas futuras dentro do mês). */
  balance: number
  savings_rate: number | null
  /** Variação (%) em relação ao mês anterior; null = o mês anterior não tem base de comparação. */
  income_change: number | null
  expense_change: number | null
  balance_change: number | null
  savings_change: number | null
  previous: PeriodTotals
  transaction_count: number
  expenses_by_category: CategoryShare[]
}

/** GET /finance/cashflow: receitas e despesas de um período qualquer (até 366 dias). */
export interface Cashflow {
  start: string
  end: string
  income: number
  expense: number
}

export type Recurrence = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'
export type AgendaStatus = 'pendente' | 'concluido' | 'cancelado'

/** Uma linha da agenda. Numa rotina, cada dia em que ela acontece é uma linha (mesmo id, `date` diferente). */
export interface AgendaItem {
  id: number
  title: string
  type: 'tarefa' | 'evento' | 'compromisso'
  /** "2026-09-20": o dia desta ocorrência. */
  date: string
  time: string | null
  status: AgendaStatus
  start_date: string | null
  recurrence: Recurrence
  /** Só em "weekly": 0 = segunda ... 6 = domingo. */
  recurrence_days: number[]
  recurrence_until: string | null
  /** Avisar quantos minutos antes (0 = na hora); null = sem lembrete. */
  reminder_minutes: number | null
}
