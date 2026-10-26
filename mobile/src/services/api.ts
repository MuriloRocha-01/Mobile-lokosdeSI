import type { FinancialProfile, ProfileInput, FinanceCard, PaymentMethod, AgendaItem, AuthResult, AuthUser, Cashflow, FinanceSummary, Recurrence, Transaction, TransactionCategory, TransactionPage, TransactionRecurrence, TransactionType } from '../@types/api'

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

let refreshToken: string | null = null
let sessionVersion = 0
let renewing: Promise<void> | null = null
let onRenewed: ((result: AuthResult) => Promise<void>) | null = null
let baseUrl = ''
let token: string | null = null
let onUnauthorized: (() => void) | null = null

/** Diz à API para onde ir e com qual login. Chamado ao abrir o app e ao entrar/sair. */
export function configureApi(options: { baseUrl?: string; token?: string | null; onUnauthorized?: () => void; refreshToken?: string | null; onRenewed?: (result: AuthResult) => Promise<void> }): void {
  if (options.baseUrl !== undefined) baseUrl = options.baseUrl
  if (options.token !== undefined) { token = options.token; sessionVersion++; renewing = null }
  if (options.refreshToken !== undefined) refreshToken = options.refreshToken
  if (options.onRenewed) onRenewed = options.onRenewed
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

async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
  const usedToken = token
  const version = sessionVersion
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  const headers: Record<string, string> = { Accept: 'application/json', ...((init.headers as Record<string, string>) ?? {}) }
  if (init.body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const writing = init.method && !['GET', 'HEAD'].includes(init.method)
  const uncertain = writing ? ' Confira se a alteração foi salva antes de tentar novamente.' : ' Tente novamente em instantes.'
  try {
    const response = await fetch(baseUrl + path, { ...init, headers, signal: controller.signal })
    if (response.status === 401 && usedToken && !['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'].includes(path)) {
      clearTimeout(timer)
      if (version !== sessionVersion) throw new ApiError('A sessão mudou. Tente novamente.', 401)
      if (!retried && refreshToken) {
        if (token === usedToken) await renewSession()
        if (version !== sessionVersion) throw new ApiError('A sessão mudou. Tente novamente.', 401)
        return request<T>(path, init, true)
      }
      onUnauthorized?.()
      throw new ApiError('Sua sessão expirou. Entre novamente para continuar.', 401)
    }
    const raw = response.status === 204 ? '' : await response.text()
    let body: any
    try { body = raw ? JSON.parse(raw) : undefined } catch { /* Proxies podem retornar HTML. */ }
    if (!response.ok) {
      const detail = typeof body?.detail === 'string' ? body.detail : ''
      let message = 'Não foi possível concluir a solicitação. Tente novamente.'
      if (response.status >= 500) message = 'O servidor encontrou um problema ao processar sua solicitação.' + uncertain
      else if (response.status === 404 && (detail === 'Not Found' || body?.code === 'route_not_found')) message = 'Este recurso ainda não está disponível no servidor. O aplicativo e o servidor podem estar em versões diferentes. Avise o responsável pelo aplicativo.'
      else if (response.status === 401) message = 'Não foi possível entrar. Confira seu e-mail e sua senha.'
      else if (response.status === 403) message = 'Sua conta não tem permissão para realizar esta ação.'
      else if (response.status === 422) message = 'Alguns dados estão inválidos. Confira os campos e tente novamente.'
      else if (response.status === 429) message = 'Muitas tentativas em pouco tempo. Aguarde um momento e tente novamente.'
      else if (detail) message = detail
      else if (response.status === 404) message = 'O registro solicitado não foi encontrado. Atualize a tela.'
      const id = response.headers.get('X-Request-ID') ?? body?.request_id
      if (typeof id === 'string' && /^[a-f0-9]{32}$/.test(id)) message += '\nCódigo de atendimento: ' + id
      throw new ApiError(message, response.status)
    }
    if (response.status === 204) return undefined as T
    if (body === undefined) throw new ApiError('O servidor enviou uma resposta que o aplicativo não conseguiu ler.' + uncertain, response.status)
    return body as T
  } catch (err) {
    if (err instanceof ApiError) throw err
    if (controller.signal.aborted) throw new ApiError('O servidor demorou demais para responder.' + uncertain)
    throw new ApiError('Não foi possível conectar ao servidor. Confira sua internet; se ela estiver funcionando, o serviço pode estar temporariamente indisponível.' + uncertain)
  } finally { clearTimeout(timer) }
}

async function renewSession(): Promise<void> {
  if (renewing) return renewing
  const version = sessionVersion
  const currentRefresh = refreshToken
  const work = (async () => {
    try {
      const result = await request<AuthResult>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refresh_token: currentRefresh }) })
      if (version !== sessionVersion) throw new ApiError('A sessão mudou. Tente novamente.')
      await onRenewed?.(result)
      if (version !== sessionVersion) throw new ApiError('A sessão mudou. Tente novamente.')
      token = result.access_token
    } catch (error) {
      if (version === sessionVersion && error instanceof ApiError && error.status === 401) onUnauthorized?.()
      throw error
    }
  })()
  renewing = work
  try { await work } finally { if (renewing === work) renewing = null }
}

export const startSession = (): Promise<AuthResult> => request('/auth/session', { method: 'POST' })
export const revokeSession = (value: string): Promise<void> => request('/auth/logout', { method: 'POST', body: JSON.stringify({ refresh_token: value }) })

const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })

export const login = (email: string, password: string): Promise<AuthResult> => request('/auth/login', post({ email, password }))
export const register = (name: string, email: string, password: string): Promise<AuthResult> => request('/auth/register', post({ name, email, password }))
export const getProfile = (): Promise<FinancialProfile | null> => request('/auth/profile')
export const saveProfile = (profile: ProfileInput): Promise<FinancialProfile> => request('/auth/profile', { method: 'PUT', body: JSON.stringify(profile) })
export const getCards = (today: string): Promise<FinanceCard[]> => request('/finance/cards?today=' + today)
export const createCard = (name: string, last_four: string): Promise<FinanceCard> => request('/finance/cards', post({ name, last_four }))
export const getCycleSummary = (today: string, cardId?: number): Promise<FinanceSummary> => request('/finance/summary?cycle=true&today=' + today + (cardId !== undefined ? '&card_id=' + cardId : ''))
export const getMe = (): Promise<AuthUser> => request('/auth/me')

export const getCategories = (): Promise<TransactionCategory[]> => request('/finance/categories')
export const getSummary = (month: string, cardId?: number): Promise<FinanceSummary> => request(`/finance/summary?month=${month}` + (cardId !== undefined ? `&card_id=${cardId}` : ''))

export interface TransactionQuery {
  status?: 'pending' | 'settled' | 'all'
  by_settlement?: boolean
  category_id?: number
  payment_method?: PaymentMethod
  card_id?: number
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
  if (query.status && query.status !== 'all') parts.push('status=' + query.status)
  if (query.from) parts.push(`from=${encodeURIComponent(query.from)}`)
  if (query.to) parts.push(`to=${encodeURIComponent(query.to)}`)
  if (query.type) parts.push(`type=${query.type}`)
  if (query.category_id !== undefined) parts.push(`category_id=${query.category_id}`)
  if (query.payment_method) parts.push(`payment_method=${query.payment_method}`)
  if (query.card_id !== undefined) parts.push(`card_id=${query.card_id}`)
  return request(`/finance/transactions?${parts.join('&')}`)
}

/** GET /finance/cashflow?start&end: receitas e despesas de um período qualquer (o servidor recusa mais de 366 dias). */
export function getCashflow(start: string, end: string, filters: TransactionQuery = {}): Promise<Cashflow> {
  const params = Object.entries(filters).filter(([, value]) => value !== undefined).map(([key, value]) => key + '=' + encodeURIComponent(String(value)))
  return request('/finance/cashflow?start=' + start + '&end=' + end + '&' + params.join('&'))
}

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
  status?: 'pending' | 'settled'
  time?: string | null
  payment_method?: PaymentMethod | null
  card_id?: number | null
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

export const getPlanning = (today: string): Promise<import('../@types/api').PlanningData> => request('/finance/planning?today=' + today)
export const saveBudget = (id: number, amount: number): Promise<unknown> => request('/finance/planning/budgets/' + id, { method: 'PUT', body: JSON.stringify({ amount }) })
export const removeBudget = (id: number): Promise<void> => request('/finance/planning/budgets/' + id, { method: 'DELETE' })
export const saveCardCycle = (id: number, closing_day: number, due_day: number): Promise<unknown> => request('/finance/planning/cards/' + id, { method: 'PUT', body: JSON.stringify({ closing_day, due_day }) })
export const createInstallments = (fields: NewTransaction & { count: number; installment_amount?: number }): Promise<{ total: number }> => request('/finance/planning/installments', post(fields))

export const getTransaction = (id: number): Promise<Transaction> => request('/finance/transactions/' + id)
export const getFinanceOverview = (today: string): Promise<import('../@types/api').FinanceOverview> => request('/finance/planning/overview?today=' + today)
export const saveGoal = (goal: Omit<import('../@types/api').SavingsGoal, 'id'>, id?: number): Promise<import('../@types/api').SavingsGoal> => request('/finance/planning/goals' + (id ? '/' + id : ''), { method: id ? 'PUT' : 'POST', body: JSON.stringify(goal) })
export const removeGoal = (id: number): Promise<void> => request('/finance/planning/goals/' + id, { method: 'DELETE' })
