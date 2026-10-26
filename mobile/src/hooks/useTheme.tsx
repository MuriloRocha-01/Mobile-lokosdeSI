import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { View } from 'react-native'
import { darkColors, lightColors } from '../config/theme'
import type { ThemeColors, ThemeMode } from '../config/theme'
import * as storage from '../services/storage'

interface ThemeContextValue {
  mode: ThemeMode
  colors: ThemeColors
  setMode: (mode: ThemeMode) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)
const KEY_THEME = 'ecossistema.theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, updateMode] = useState<ThemeMode>('light')
  const [ready, setReady] = useState(false)
  const pendingWrite = useRef(Promise.resolve())

  useEffect(() => {
    let alive = true
    void storage.getItem(KEY_THEME).then(saved => {
      if (!alive) return
      updateMode(saved === 'dark' ? 'dark' : 'light')
      setReady(true)
    })
    return () => { alive = false }
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    updateMode(next)
    // Serializa gravações para preservar a última escolha mesmo em toques rápidos.
    pendingWrite.current = pendingWrite.current.then(() => storage.setItem(KEY_THEME, next))
  }, [])

  const value = useMemo(() => ({ mode, colors: mode === 'dark' ? darkColors : lightColors, setMode }), [mode, setMode])
  if (!ready) return <View style={{ flex: 1, backgroundColor: lightColors.bg }} />
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme precisa estar dentro do ThemeProvider.')
  return value
}
