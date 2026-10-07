import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import * as api from '../services/api'
import * as storage from '../services/storage'
import type { AuthUser } from '../@types/api'
import { DEFAULT_SERVER_URL } from '../config/server'

type Status = 'loading' | 'anonymous' | 'authenticated'

interface AuthContextValue {
  status: Status
  user: AuthUser | null
  /** Endereço do servidor em uso (ex.: "https://meu-pc.tail1234.ts.net"). */
  server: string
  /** Entra no servidor. Lança Error com a mensagem para mostrar se algo falhar. */
  signIn: (server: string, email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const KEY_SERVER = 'ecossistema.server'
const KEY_TOKEN = 'ecossistema.token'
const KEY_USER = 'ecossistema.user'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [user, setUser] = useState<AuthUser | null>(null)
  const [server, setServer] = useState(DEFAULT_SERVER_URL)

  const clear = useCallback(async () => {
    api.configureApi({ token: null })
    await Promise.all([storage.removeItem(KEY_TOKEN), storage.removeItem(KEY_USER)])
    setUser(null)
    setStatus('anonymous')
  }, [])

  // Ao abrir o app: se já havia login, entra direto (sem esperar a rede) e confere o token em segundo plano.
  useEffect(() => {
    api.configureApi({ onUnauthorized: () => void clear() })
    let alive = true
    void (async () => {
      const [savedServer, savedToken, savedUser] = await Promise.all([storage.getItem(KEY_SERVER), storage.getItem(KEY_TOKEN), storage.getItem(KEY_USER)])
      if (!alive) return
      setServer(DEFAULT_SERVER_URL)
      if (savedServer !== DEFAULT_SERVER_URL || !savedToken) {
        setStatus('anonymous')
        return
      }
      api.configureApi({ baseUrl: DEFAULT_SERVER_URL, token: savedToken })
      try {
        setUser(savedUser ? (JSON.parse(savedUser) as AuthUser) : null)
      } catch {
        setUser(null)
      }
      setStatus('authenticated')
      api.getMe().catch(() => {
        /* sem rede agora: continua entrado. Se o token não vale mais, a API chama onUnauthorized */
      })
    })()
    return () => {
      alive = false
    }
  }, [clear])

  const signIn = useCallback(async (serverInput: string, email: string, password: string) => {
    const url = api.normalizeServerUrl(serverInput)
    if (!email.trim() || !password) throw new Error('Digite o e-mail e a senha.')
    api.configureApi({ baseUrl: url, token: null })
    const result = await api.login(email.trim(), password)
    api.configureApi({ token: result.access_token })
    await Promise.all([storage.setItem(KEY_SERVER, url), storage.setItem(KEY_TOKEN, result.access_token), storage.setItem(KEY_USER, JSON.stringify(result.user))])
    setServer(url)
    setUser(result.user)
    setStatus('authenticated')
  }, [])

  const value = useMemo(() => ({ status, user, server, signIn, signOut: clear }), [status, user, server, signIn, clear])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth precisa estar dentro do AuthProvider.')
  return value
}
