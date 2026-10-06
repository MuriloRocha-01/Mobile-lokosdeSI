import type { AgendaItem, AuthResult, AuthUser, Cashflow, FinanceSummary, Recurrence, Transaction, TransactionCategory, TransactionPage, TransactionRecurrence, TransactionType } from './types'

/** Erro com uma mensagem pronta para mostrar (em português). */
export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message)
  }
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : 'Algo deu errado.')

let baseUrl = ''
let token: string | null = null
let onUnauthorized: (() => void) | null = null

/** Diz à API para onde ir e com qual login. Chamado ao abrir o app e ao entrar/sair. */
export function configureApi(options: { baseUrl?: string; token?: string | null; onUnauthorized?: () => void }): void {
  if (options.baseUrl !== undefined) baseUrl = options.baseUrl
  if (options.token !== undefined) token = options.token
  if (options.onUnauthorized) onUnauthorized = options.onUnauthorized
}

/**
 * "meu-pc.tail1234.ts.net" -> "https://meu-pc.tail1234.ts.net". Sem "http://" explícito, usa https (a senha
 * e os valores não devem trafegar sem criptografia pela internet). Lança Error com a mensagem para mostrar.
 */
export function normalizeServerUrl(input: string): string {
  let text = input.trim()
  if (!text) throw new Error('Digite o endereço do servidor (o do PC onde o Lokos de S.I roda).')
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`
  let url: URL
  try {
    url = new URL(text)
  } catch {
    throw new Error('Esse endereço não parece válido. Exemplo: https://meu-pc.tail1234.ts.net')
  }
  return `${url.protocol}//${url.host}`
}

const TIMEOUT_MS = 15_000

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json', ...((init.headers as Record<string, string>) ?? {}) }
  if (init.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, { ...init, headers, signal: controller.signal })
  } catch {
    throw new ApiError('Não consegui falar com o servidor. Confira a internet, o endereço e se o Lokos de S.I está aberto no PC.')
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 401 && token && !path.startsWith('/auth/login')) {
    onUnauthorized?.()
    throw new ApiError('Sua sessão expirou. Entre de novo.', 401)
  }
  if (!response.ok) {
    let detail = `Erro ${response.status} do servidor.`
    try {
      const body = await response.json()
      if (typeof body?.detail === 'string') detail = body.detail
      else if (Array.isArray(body?.detail)) detail = 'Confira os dados informados.'
    } catch {
      /* corpo sem JSON: fica a mensagem padrão */
    }
    throw new ApiError(detail, response.status)
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T)
}

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const login = (email: string, password: string): Promise<AuthResult> => request('/auth/login', post({ email, password }))
export const getMe = (): Promise<AuthUser> => request('/auth/me')

export const getCategories = (): Promise<TransactionCategory[]> => request('/finance/categories')
export const getSummary = (month: string): Promise<FinanceSummary> => request(`/finance/summary?month=${month}`)

export interface TransactionQuery {
  limit?: number
  offset?: number
  /** Primeiro e último dia (inclusive), "2026-09-20". */
  from?: string
  to?: string
  type?: TransactionType
}

/** GET /finance/transactions: da mais recente para a mais antiga. A query é montada à mão (sem `URLSearchParams`, que no RN é parcial). */
export function listTransactions(query: TransactionQuery = {}): Promise<TransactionPage> {
  const parts = [`limit=${query.limit ?? 30}`, `offset=${query.offset ?? 0}`]
  if (query.from) parts.push(`from=${encodeURIComponent(query.from)}`)
  if (query.to) parts.push(`to=${encodeURIComponent(query.to)}`)
  if (query.type) parts.push(`type=${query.type}`)
  return request(`/finance/transactions?${parts.join('&')}`)
}

/** GET /finance/cashflow?start&end: receitas e despesas de um período qualquer (o servidor recusa mais de 366 dias). */
export const getCashflow = (start: string, end: string): Promise<Cashflow> => request(`/finance/cashflow?start=${start}&end=${end}`)

export interface CategoryFields {
  name: string
  type: TransactionType
  /** Emoji (ou uma das chaves padrão). */
  icon: string
  /** "#rrggbb" */
  color: string
}

/** POST /finance/categories: cria uma categoria (motivo) só sua. */
export const createCategory = (fields: CategoryFields): Promise<TransactionCategory> => request('/finance/categories', post(fields))

/** PUT /finance/categories/{id}: só categorias suas (as padrão não mudam); o tipo não muda. */
export const updateCategory = (id: number, changes: Partial<Omit<CategoryFields, 'type'>>): Promise<TransactionCategory> =>
  request(`/finance/categories/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

/** DELETE /finance/categories/{id}: o servidor recusa (409) se ainda houver transações nela. */
export const deleteCategory = (id: number): Promise<void> => request(`/finance/categories/${id}`, { method: 'DELETE' })

export interface NewTransaction {
  description: string
  amount: number
  date: string
  type: TransactionType
  category_id: number
  /** "monthly"/"yearly" faz desta transação a âncora de uma série (gasto/receita fixo). */
  recurrence?: TransactionRecurrence
  recurrence_until?: string | null
}

/** POST /finance/transactions: grava direto no FastAPI que roda no PC. */
export const createTransaction = (fields: NewTransaction): Promise<Transaction> => request('/finance/transactions', post(fields))

/** PUT /finance/transactions/{id}: atualização parcial (só o que for enviado muda). */
export const updateTransaction = (id: number, changes: Partial<NewTransaction>): Promise<Transaction> =>
  request(`/finance/transactions/${id}`, { method: 'PUT', body: JSON.stringify(changes) })

/** DELETE /finance/transactions/{id}: apaga (se era uma âncora, o servidor solta as ocorrências já geradas por ela). */
export const deleteTransaction = (id: number): Promise<void> => request(`/finance/transactions/${id}`, { method: 'DELETE' })

// ------------------------------------------------------------------ Agenda

/** GET /agenda?from&to: os itens entre dois dias (inclusive); cada ocorrência de uma rotina vem como uma linha. */
export const listAgenda = (from: string, to: string): Promise<AgendaItem[]> => request(`/agenda?from=${from}&to=${to}`)

export interface NewAgendaItem {
  title: string
  type: 'tarefa' | 'evento' | 'compromisso'
  date: string
  time: string | null
  recurrence: Recurrence
  recurrence_days: number[]
  reminder_minutes: number | null
}

export const createAgendaItem = (fields: NewAgendaItem): Promise<AgendaItem> => request('/agenda', post(fields))

/** Marca (ou desmarca) como feito um item avulso. */
export const setAgendaStatus = (id: number, status: 'pendente' | 'concluido'): Promise<AgendaItem> =>
  request(`/agenda/${id}`, { method: 'PUT', body: JSON.stringify({ status }) })

/** Marca (ou desmarca) como feita a rotina de UM dia. */
export const setOccurrenceDone = (id: number, day: string, done: boolean): Promise<AgendaItem> =>
  request(`/agenda/${id}/occurrences/${day}`, { method: 'PUT', body: JSON.stringify({ done }) })
