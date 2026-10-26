import Constants from 'expo-constants'
import { Platform } from 'react-native'
import { listAgenda } from '../api'
import { addDays, fromIso, todayIso } from '../../utils/format'
import * as storage from '../storage'
import type { FinancialProfile } from '../../@types/api'
import { planFinancialReminders, planReminders } from './plan'

const CHANNEL = 'lembretes'
const WINDOW_DAYS = 45
const LIMIT = Platform.OS === 'ios' ? 60 : 200
export const remindersSupported = Platform.OS !== 'web' && Constants.executionEnvironment !== 'storeClient'
const Notifications: typeof import('expo-notifications') | null = remindersSupported ? require('expo-notifications') : null
let account: string | null = null
let profile: FinancialProfile | null = null
let generation = 0
let running: Promise<unknown> = Promise.resolve()
export const getReminderAccount = () => account
export function configureReminders(identity: string, financialProfile: FinancialProfile | null) {
  if (identity !== account) generation++
  account = identity
  profile = financialProfile
}
const preferenceKey = () => 'ecossistema.reminders.' + Array.from(account ?? '').map((char) => char.charCodeAt(0).toString(16)).join('-')
if (remindersSupported) Notifications!.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })
export interface ReminderStatus { enabled: boolean; permission: boolean; scheduled: number; error?: string }
export async function isEnabled() { return account !== null && (await storage.getItem(preferenceKey())) !== 'off' }
export async function setEnabled(enabled: boolean) { await storage.setItem(preferenceKey(), enabled ? 'on' : 'off') }
async function ensureChannel() {
  if (Platform.OS === 'android') await Notifications!.setNotificationChannelAsync(CHANNEL, { name: 'Agenda e finanças', importance: Notifications!.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250] })
}
export async function ensurePermission() {
  if (!remindersSupported) return false
  await ensureChannel()
  const current = await Notifications!.getPermissionsAsync()
  if (current.granted) return true
  return current.canAskAgain && (await Notifications!.requestPermissionsAsync()).granted
}
export async function clearReminders() {
  generation++
  account = null
  profile = null
  const next = running.catch(() => {}).then(async () => {
    if (remindersSupported) {
      await Notifications!.cancelAllScheduledNotificationsAsync()
      await Notifications!.dismissAllNotificationsAsync()
      await Notifications!.clearLastNotificationResponseAsync()
    }
  })
  running = next
  await next
}
async function doSync(): Promise<ReminderStatus> {
  if (!remindersSupported || !account) return { enabled: false, permission: false, scheduled: 0 }
  const identity = account, version = generation, financialProfile = profile
  const current = () => identity === account && version === generation
  const enabled = await isEnabled()
  if (!current()) return { enabled: false, permission: false, scheduled: 0 }
  if (!enabled) { await Notifications!.cancelAllScheduledNotificationsAsync(); return { enabled, permission: true, scheduled: 0 } }
  const permission = await ensurePermission()
  if (!permission || !current()) return { enabled, permission: false, scheduled: 0 }
  const today = todayIso(), through = fromIso(addDays(today, WINDOW_DAYS + 1))
  const rows = await listAgenda(today, addDays(today, WINDOW_DAYS))
  if (!current()) return { enabled: false, permission: false, scheduled: 0 }
  const now = new Date()
  const plan = [...planReminders(rows, now, LIMIT), ...(financialProfile ? planFinancialReminders(financialProfile, now, through) : [])].sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key)).slice(0, LIMIT)
  await Notifications!.cancelAllScheduledNotificationsAsync()
  for (const reminder of plan) {
    if (!current()) break
    await Notifications!.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body, sound: true, data: { key: reminder.key, account: identity, screen: reminder.key.startsWith('finance|') ? 'financas' : 'agenda' } },
      trigger: { type: Notifications!.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL },
    })
  }
  return { enabled, permission, scheduled: plan.length }
}
export function syncReminders(): Promise<ReminderStatus> {
  const next = running.catch(() => {}).then(doSync).catch(async () => ({ ...(await status()), error: 'Não foi possível atualizar os avisos. Confira a conexão e tente novamente.' }))
  running = next
  return next
}
export async function status(): Promise<ReminderStatus> {
  if (!remindersSupported) return { enabled: false, permission: false, scheduled: 0 }
  try {
    const [enabled, permission, scheduled] = await Promise.all([isEnabled(), Notifications!.getPermissionsAsync().then((p) => p.granted), Notifications!.getAllScheduledNotificationsAsync().then((list) => list.length)])
    return { enabled, permission, scheduled }
  } catch { return { enabled: false, permission: false, scheduled: 0, error: 'Não foi possível acessar as notificações deste aparelho.' } }
}
export async function sendTestReminder() {
  if (!(await ensurePermission())) return false
  await Notifications!.scheduleNotificationAsync({ content: { title: 'Lembrete de teste', body: 'Seus avisos estão funcionando. Toque para abrir a agenda.', sound: true, data: { screen: 'agenda', account } }, trigger: { type: Notifications!.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL } })
  return true
}
