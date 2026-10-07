import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../hooks/useAuth'
import { remindersSupported, sendTestReminder, setEnabled, status as reminderStatus, syncReminders } from '../services/reminders'
import type { ReminderStatus } from '../services/reminders'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'

/** Aba "Conta": com quem e onde está conectado, os lembretes deste celular e sair. */
export function AccountScreen({ onRemindersChanged, onImport, onBankAutomation }: { onRemindersChanged?: () => void; onImport: () => void; onBankAutomation: () => void }) {
  const { colors, mode, setMode } = useTheme()
  const styles = createStyles(colors)
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
    <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}>
      <Text style={styles.title}>Sua conta</Text>
      <Text style={styles.subtitle}>Seu perfil e suas preferências, num só lugar.</Text>

      <View style={[styles.card, styles.column]}>
        <Text style={styles.name}>Seus bancos</Text>
        <Text style={styles.note}>CAIXA e Nubank: importe extratos ou configure avisos de compras e Pix.</Text>
        <Pressable onPress={onImport} accessibilityRole="button" style={styles.action}><MaterialCommunityIcons name="file-upload-outline" size={22} color={colors.primary} /><Text style={styles.actionText}>Importar extrato OFX/CSV</Text></Pressable>
        <Pressable onPress={onBankAutomation} accessibilityRole="button" style={styles.action}><MaterialCommunityIcons name="bank-outline" size={22} color={colors.primary} /><Text style={styles.actionText}>Notificações bancárias / Tasker</Text></Pressable>
      </View>

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

      <View style={[styles.card, styles.column]}>
        <View style={styles.row}>
          <MaterialCommunityIcons name="palette-outline" size={24} color={colors.primary} />
          <View style={styles.cardBody}>
            <Text style={styles.name}>Aparência</Text>
            <Text style={styles.meta}>Escolha o tema deste aparelho.</Text>
          </View>
        </View>
        <View style={styles.themeOptions} accessibilityRole="radiogroup" accessibilityLabel="Tema do aplicativo">
          {([{ id: 'light', label: 'Claro', icon: 'white-balance-sunny' }, { id: 'dark', label: 'Escuro', icon: 'moon-waning-crescent' }] as const).map(option => (
            <Pressable key={option.id} onPress={() => setMode(option.id)} accessibilityRole="radio" accessibilityLabel={`Tema ${option.label.toLowerCase()}`} accessibilityState={{ checked: mode === option.id }} aria-checked={mode === option.id} style={({ pressed }) => [styles.themeOption, mode === option.id && styles.themeSelected, pressed && { opacity: 0.75 }]}>
              <MaterialCommunityIcons name={option.icon} size={20} color={mode === option.id ? colors.primary : colors.muted} />
              <Text style={[styles.themeText, mode === option.id && { color: colors.primary }]}>{option.label}</Text>
              {mode === option.id ? <MaterialCommunityIcons name="check-circle" size={18} color={colors.primary} /> : null}
            </Pressable>
          ))}
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
          {remindersSupported && reminders ? <Switch value={reminders.enabled} onValueChange={(value) => void toggle(value)} disabled={busy} trackColor={{ true: colors.primary, false: colors.cardHigh }} thumbColor={colors.onPrimary} /> : null}
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

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 20, gap: 16, paddingBottom: 32 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 14, lineHeight: 21, marginTop: -8, marginBottom: 8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, borderRadius: radius.lg, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  column: { flexDirection: 'column', alignItems: 'stretch' },
  themeOptions: { flexDirection: 'row', gap: 10 },
  themeOption: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', gap: 8, padding: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  themeSelected: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  themeText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  cardBody: { flex: 1 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.primary, fontSize: 18, fontWeight: '700' },
  name: { color: colors.text, fontSize: 17, fontWeight: '600' },
  meta: { color: colors.faint, fontSize: 13 },
  value: { color: colors.text, fontSize: 15, marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border },
  actionText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  note: { color: colors.faint, fontSize: 13, lineHeight: 19 },
  logout: { backgroundColor: colors.dangerSoft, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 52, borderRadius: radius.lg, borderWidth: 1, borderColor: `${colors.expense}55`, marginTop: 8 },
  logoutText: { color: colors.expense, fontSize: 16, fontWeight: '600' },
})
