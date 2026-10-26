import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from './api'
import { SERVER_URL, canRestoreSession } from './server'
import { clearReminders } from './reminders'
import { clearWidgets } from './widgets'
import * as storage from './storage'
import type { AuthUser } from './types'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthContextValue {
  status: Status
  sessionMessage: string
  user: AuthUser | null
  /** Endereço do servidor em uso (ex.: "https://meu-pc.tail1234.ts.net"). */
  server: string
  /** Entra no servidor. Lança Error com a mensagem para mostrar se algo falhar. */
  signIn: (email: string, password: string, name?: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const KEY_SERVER = 'ecossistema.server'
const KEY_TOKEN = 'ecossistema.token'
let persistence = Promise.resolve()
function persist(work: () => Promise<unknown>): Promise<void> {
  persistence = persistence.catch(() => {}).then(async () => { await work() })
  return persistence
}

const KEY_REFRESH = 'ecossistema.refresh'
const KEY_USER = 'ecossistema.user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const generation = useRef(0)
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')
  const server = SERVER_URL

  const clear = useCallback(async () => {
    generation.current++
    setUser(null)
    setStatus('anonymous')
    api.configureApi({ token: null, refreshToken: null })
    await persist(() => Promise.all([storage.removeItem(KEY_TOKEN), storage.removeItem(KEY_USER), storage.removeItem(KEY_REFRESH)]))
    await clearWidgets().catch(() => {})
    await clearReminders().catch(() => {})
    setUser(null)
    setStatus('anonymous')
  }, [])

  // Ao abrir o app: se já havia login, entra direto (sem esperar a rede) e confere o token em segundo plano.
  useEffect(() => {
    api.configureApi({ baseUrl: SERVER_URL, onRenewed: async (result) => { await persist(() => storage.setItem(KEY_TOKEN, result.access_token)) }, onUnauthorized: () => { setSessionMessage('Sua sessão expirou. Entre novamente para continuar.'); void clear() } })
    let alive = true
    void (async () => {
      const [savedServer, savedToken, savedUser, savedRefresh] = await Promise.all([storage.getItem(KEY_SERVER), storage.getItem(KEY_TOKEN), storage.getItem(KEY_USER), storage.getItem(KEY_REFRESH)])
      if (!alive) return
      if (!canRestoreSession(savedServer) || !savedToken) {
        setStatus('anonymous')
        return
      }
      api.configureApi({ baseUrl: SERVER_URL, token: savedToken, refreshToken: savedRefresh })
      try {
        const cached = savedUser ? JSON.parse(savedUser) as AuthUser : null
        if (!cached?.id) { void clear(); return }
        setUser(cached)
      } catch { void clear(); return }
      setStatus('authenticated')
      if (!savedRefresh) {
        const currentGeneration = generation.current
        void api.startSession().then(async result => {
          if (!alive || currentGeneration !== generation.current || !result.refresh_token) return
          await persist(() => storage.setItem(KEY_REFRESH, result.refresh_token!))
          if (currentGeneration !== generation.current) return
          api.configureApi({ refreshToken: result.refresh_token })
        }).catch(() => {})
      }
      api.getMe().catch(() => {
        /* sem rede agora: continua entrado. Se o token não vale mais, a API chama onUnauthorized */
      })
    })()
    return () => {
      alive = false
    }
  }, [clear])

  const signIn = useCallback(async (email: string, password: string, name?: string) => {
    generation.current++
    const url = SERVER_URL
    if (!email.trim() || !password) throw new Error('Digite o e-mail e a senha.')
    api.configureApi({ baseUrl: url, token: null, refreshToken: null })
    const result = name === undefined ? await api.login(email.trim(), password) : await api.register(name.trim(), email.trim(), password)
    api.configureApi({ token: result.access_token, refreshToken: result.refresh_token ?? null })
    await persist(() => Promise.all([storage.setItem(KEY_SERVER, url), storage.setItem(KEY_TOKEN, result.access_token), storage.setItem(KEY_USER, JSON.stringify(result.user)), result.refresh_token ? storage.setItem(KEY_REFRESH, result.refresh_token) : storage.removeItem(KEY_REFRESH)]))
    setSessionMessage('')
    setUser(result.user)
    setStatus('authenticated')
  }, [])

  const signOut = useCallback(async () => {
    const refresh = await storage.getItem(KEY_REFRESH)
    await clear()
    if (refresh) await api.revokeSession(refresh).catch(() => {})
  }, [clear])

  const value = useMemo(() => ({ status, user, server, sessionMessage, signIn, signOut }), [status, user, server, sessionMessage, signIn, signOut])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth precisa estar dentro do AuthProvider.')
  return value
}

