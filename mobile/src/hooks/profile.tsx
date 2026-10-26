import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import { errorMessage, getProfile, saveProfile } from '../services/api'
import { useAuth } from './useAuth'
import { configureReminders, setEnabled } from '../services/reminders'
import { OnboardingScreen } from '../screens/OnboardingScreen'
import type { ThemeColors } from '../config/theme'
import { useTheme } from './useTheme'
import type { FinancialProfile, ProfileInput } from '../@types/api'

const ProfileContext = createContext<{ profile: FinancialProfile; save: (input: ProfileInput) => Promise<void> } | null>(null)
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  const { user, server, signOut } = useAuth()
  const [profile, setProfile] = useState<FinancialProfile | null>()
  const [error, setError] = useState('')
  const load = useCallback(async () => {
    setError('')
    try { setProfile(await getProfile()) } catch (err) { setError(errorMessage(err)) }
  }, [])
  useEffect(() => { void load() }, [load])
  const identity = server + '|' + user!.id
  configureReminders(identity, profile ?? null)
  async function save(input: ProfileInput) { setProfile(await saveProfile(input)) }
  if (error) return <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: colors.bg, gap: 20 }}><Text style={{ color: colors.text, fontSize: 22, fontWeight: '700' }}>NÃ£o foi possÃ­vel carregar seu perfil</Text><Text accessibilityRole="alert" selectable style={{ color: colors.muted, fontSize: 16, lineHeight: 24 }}>{error}</Text><Pressable onPress={() => void load()}><Text style={{ color: colors.income }}>Tentar novamente</Text></Pressable><Pressable onPress={() => void signOut()}><Text style={{ color: colors.muted }}>Sair</Text></Pressable></View>
  if (profile === undefined) return <View style={{ flex: 1, backgroundColor: colors.bg, justifyContent: 'center' }}><ActivityIndicator color={colors.muted} /></View>
  if (profile === null) return <OnboardingScreen name={user?.name ?? ''} onCancel={() => void signOut()} onSave={async (input, reminders) => { await setEnabled(reminders); await save(input) }} />
  return <ProfileContext.Provider value={{ profile, save }}>{children}</ProfileContext.Provider>
}
export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) throw new Error('Perfil nÃ£o carregado.')
  return context
}
