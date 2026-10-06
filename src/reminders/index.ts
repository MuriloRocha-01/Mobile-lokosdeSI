import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import { listAgenda } from '../api'
import { addDays, todayIso } from '../format'
import * as storage from '../storage'
import { planReminders } from './plan'

// Os lembretes são avisos AGENDADOS NO PRÓPRIO CELULAR (não dependem do PC estar ligado na hora do aviso, nem de
// nenhum serviço de push). O app busca a agenda no servidor, calcula os próximos avisos e agenda todos de uma vez;
// isso se repete sempre que o app abre, volta para a tela, ou algo muda na agenda.

const CHANNEL = 'lembretes'
const KEY_ENABLED = 'ecossistema.reminders'
/** Quantos dias à frente a agenda é lida para agendar os avisos. */
const WINDOW_DAYS = 45
/** O iOS guarda no máximo 64 avisos agendados; o Android aguenta bem mais. */
const LIMIT = Platform.OS === 'ios' ? 60 : 200

export const remindersSupported = Platform.OS !== 'web'

if (remindersSupported) {
  // Com o app aberto, o aviso também aparece (por padrão o sistema o esconderia).
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  })
}

export interface ReminderStatus {
  /** O usuário deixou os lembretes ligados? */
  enabled: boolean
  /** O sistema permitiu avisos deste app? */
  permission: boolean
  /** Quantos avisos estão agendados agora. */
  scheduled: number
}

export async function isEnabled(): Promise<boolean> {
  return (await storage.getItem(KEY_ENABLED)) !== 'off'
}

export async function setEnabled(enabled: boolean): Promise<void> {
  await storage.setItem(KEY_ENABLED, enabled ? 'on' : 'off')
}

async function ensureChannel(): Promise<void> {
  if (Platform.OS !== 'android') return
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Lembretes da agenda',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
  })
}

/** Pede a permissão de avisos (se ainda não foi pedida). Devolve se está liberada. */
export async function ensurePermission(): Promise<boolean> {
  if (!remindersSupported) return false
  await ensureChannel()
  const current = await Notifications.getPermissionsAsync()
  if (current.granted) return true
  if (!current.canAskAgain) return false
  return (await Notifications.requestPermissionsAsync()).granted
}

let running: Promise<unknown> = Promise.resolve()

async function doSync(): Promise<ReminderStatus> {
  if (!remindersSupported) return { enabled: false, permission: false, scheduled: 0 }
  const enabled = await isEnabled()
  if (!enabled) {
    await Notifications.cancelAllScheduledNotificationsAsync()
    return { enabled: false, permission: true, scheduled: 0 }
  }
  const permission = await ensurePermission()
  if (!permission) return { enabled, permission: false, scheduled: 0 }

  const today = todayIso()
  const rows = await listAgenda(today, addDays(today, WINDOW_DAYS))
  const plan = planReminders(rows, new Date(), LIMIT)
  // Recomeça do zero: assim o que foi apagado, concluído ou remarcado na agenda deixa de avisar.
  await Notifications.cancelAllScheduledNotificationsAsync()
  for (const reminder of plan) {
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body, sound: true, data: { key: reminder.key } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, channelId: CHANNEL },
    })
  }
  return { enabled, permission, scheduled: plan.length }
}

/**
 * Lê a agenda no servidor e agenda os próximos avisos neste celular. Uma chamada por vez (as seguintes esperam).
 * Sem rede, mantém o que já estava agendado e devolve o estado atual.
 */
export function syncReminders(): Promise<ReminderStatus> {
  const next = running.then(() => doSync()).catch(() => status())
  running = next
  return next
}
/** Como estão os lembretes agora (sem mexer em nada). */
export async function status(): Promise<ReminderStatus> {
  if (!remindersSupported) return { enabled: false, permission: false, scheduled: 0 }
  const [enabled, permission, scheduled] = await Promise.all([
    isEnabled(),
    Notifications.getPermissionsAsync().then((p) => p.granted),
    Notifications.getAllScheduledNotificationsAsync().then((list) => list.length),
  ])
  return { enabled, permission, scheduled }
}

/** Um aviso de teste daqui a 5 segundos: serve para conferir que o celular mostra os lembretes. */
export async function sendTestReminder(): Promise<boolean> {
  if (!(await ensurePermission())) return false
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Lembrete de teste', body: 'Se você está vendo isto, os lembretes da agenda funcionam neste celular.', sound: true },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 5, channelId: CHANNEL },
  })
  return true
}
