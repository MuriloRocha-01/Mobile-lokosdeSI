import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../auth'
import { remindersSupported, sendTestReminder, setEnabled, status as reminderStatus, syncReminders } from '../reminders'
import type { ReminderStatus } from '../reminders'
import { colors, radius } from '../theme'

/** Aba "Conta": com quem e onde está conectado, os lembretes deste celular e sair. */
export function AccountScreen({ onRemindersChanged }: { onRemindersChanged?: () => void }) {
  const { user, server, signOut } = useAuth()
  const insets = useSafeAreaInsets()
  const [reminders, setReminders] = useState<ReminderStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = useCallback(async () => setReminders(await reminderStatus()), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(value: boolean) {
    setBusy(true)
    setMessage('')
    await setEnabled(value)
    setReminders(await syncReminders()) // liga: pede a permissão e agenda; desliga: cancela tudo
    setBusy(false)
    onRemindersChanged?.()
  }

  async function syncNow() {
    setBusy(true)
    setMessage('')
    const result = await syncReminders()
    setReminders(result)
    setMessage(result.permission ? `${result.scheduled} aviso(s) agendado(s) para os próximos dias.` : 'O celular não permitiu avisos deste app. Libere nas configurações do sistema.')
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    const ok = await sendTestReminder()
    setMessage(ok ? 'Aviso de teste enviado: ele chega em 5 segundos.' : 'O celular não permitiu avisos deste app. Libere nas configurações do sistema.')
    setBusy(false)
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12 }]}>
      <Text style={styles.title}>Conta</Text>

      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(user?.name ?? '?').charAt(0).toUpperCase()}</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.name}>{user?.name ?? 'Conectado'}</Text>
          {user?.email ? <Text style={styles.meta}>{user.email}</Text> : null}
        </View>
      </View>

      <View style={styles.card}>
        <MaterialCommunityIcons name="server-network" size={24} color={colors.muted} />
        <View style={styles.cardBody}>
          <Text style={styles.meta}>Servidor</Text>
          <Text style={styles.value} selectable>
            {server}
          </Text>
        </View>
      </View>

      {/* Lembretes da agenda */}
      <View style={[styles.card, styles.column]}>
        <View style={styles.row}>
          <MaterialCommunityIcons name="bell-ring-outline" size={24} color={colors.muted} />
          <View style={styles.cardBody}>
            <Text style={styles.name}>Lembretes da agenda</Text>
            <Text style={styles.meta}>
              {!remindersSupported
                ? 'Só funcionam no aplicativo do celular.'
                : reminders === null
                  ? 'Verificando...'
                  : !reminders.enabled
                    ? 'Desligados neste celular.'
                    : !reminders.permission
                      ? 'Ligados, mas o celular não liberou avisos.'
                      : `${reminders.scheduled} aviso(s) agendado(s) neste celular`}
            </Text>
          </View>
          {remindersSupported && reminders ? <Switch value={reminders.enabled} onValueChange={(value) => void toggle(value)} disabled={busy} trackColor={{ true: colors.income, false: colors.cardHigh }} thumbColor="#fff" /> : null}
        </View>

        {remindersSupported && reminders?.enabled ? (
          <View style={styles.actions}>
            <Pressable onPress={() => void syncNow()} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
              <MaterialCommunityIcons name="sync" size={18} color={colors.text} />
              <Text style={styles.actionText}>Sincronizar agora</Text>
            </Pressable>
            <Pressable onPress={() => void test()} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}>
              <MaterialCommunityIcons name="bell-plus-outline" size={18} color={colors.text} />
              <Text style={styles.actionText}>Testar aviso</Text>
            </Pressable>
            {busy ? <ActivityIndicator color={colors.muted} /> : null}
          </View>
        ) : null}
        {message ? <Text style={styles.note}>{message}</Text> : null}
        {remindersSupported ? (
          <Text style={styles.note}>Os avisos ficam agendados no próprio celular e são atualizados sempre que você abre o app ou muda algo na agenda.</Text>
        ) : null}
      </View>

      <Pressable onPress={() => void signOut()} accessibilityRole="button" style={({ pressed }) => [styles.logout, pressed && { opacity: 0.7 }]}>
        <MaterialCommunityIcons name="logout" size={20} color={colors.expense} />
        <Text style={styles.logoutText}>Sair</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, gap: 12, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700', marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardBody: { flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.cardHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: 18, fontWeight: '700' },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  meta: { color: colors.faint, fontSize: 13 },
  value: { color: colors.text, fontSize: 15, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  note: { color: colors.faint, fontSize: 13, lineHeight: 19 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.lg, borderWidth: 1, borderColor: `${colors.expense}55`, marginTop: 8 },
  logoutText: { color: colors.expense, fontSize: 16, fontWeight: '600' },
})
