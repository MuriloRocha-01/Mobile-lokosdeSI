// Formatos que a API do Lokos de S.I (FastAPI no PC) devolve. Os mesmos do app desktop.

export type TransactionType = 'income' | 'expense'

export interface AuthUser {
  id: number
  name: string
  email: string
  is_admin: boolean
}

export interface AuthResult {
  refresh_token?: string | null
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
  status?: 'pending' | 'settled'
  settled_at?: string | null
  installment_number?: number | null
  installment_count?: number | null
  time?: string | null
  payment_method: PaymentMethod | null
  card_id: number | null
  card: FinanceCard | null
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
  start?: string
  end?: string
  expenses_by_card?: CardShare[]
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
  days: { date: string; income: number; expense: number }[]
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

export type PaymentMethod = 'credit_card' | 'debit_card' | 'cash' | 'pix' | 'meal_voucher'
export interface FinanceCard { id: number; name: string; last_four: string; income?: number; expense?: number; balance?: number }
export interface FinancialProfile { name: string; salary_day: number; bills_day: number; cycle_day: number; photo: string | null }
export interface ProfileInput extends FinancialProfile { card?: { name: string; last_four: string } }
export interface CardShare { card_id: number; name: string; last_four: string; total: number; percent: number }
export interface PlanningData {
  today: string; opening: number
  forecast: { month: string; income: number; expense: number; balance: number }[]
  budgets: { category_id: number; name: string; icon: string; color: string; limit: number | null; spent: number }[]
  cards: { id: number; name: string; last_four: string; closing_day: number | null; due_day: number | null }[]
  invoices: { card_id: number; month: string; due: string; total: number; items: { id: number | null; description: string; date: string; amount: number; projected: boolean; status?: 'pending' | 'settled' }[] }[]
}

export interface SavingsGoal { id: number; name: string; target: number; reserved: number }
export interface FinanceOverview {
  balance: number; reserved: number; available: number
  pending: { income: number; expense: number }
  goals: SavingsGoal[]
  monthly: number; annual: number
  subscriptions: { id: number; name: string; amount: number; recurrence: 'monthly' | 'yearly'; monthly: number; annual: number; starts: string; until: string | null }[]
}
