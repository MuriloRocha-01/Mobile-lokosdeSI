import { widgetsSupported, pinWidget, WIDGET_NAMES } from '../services/widgets'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { CardFormModal } from '../components/CardFormModal'
import { OnboardingScreen } from './OnboardingScreen'
import { useProfile } from '../hooks/profile'
import { getCards, errorMessage } from '../services/api'
import { brl, todayIso } from '../utils/format'
import { cardLabel } from '../utils/payment'
import type { FinanceCard } from '../@types/api'
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
  const { profile, save } = useProfile()
  const [editingProfile, setEditingProfile] = useState(false)
  const [cardForm, setCardForm] = useState(false)
  const [cards, setCards] = useState<FinanceCard[]>([])
  const loadCards = useCallback(async () => { try { setCards(await getCards(todayIso())) } catch (err) { setMessage(errorMessage(err)) } }, [])
  useEffect(() => { void loadCards() }, [loadCards])
  const [reminders, setReminders] = useState<ReminderStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [widgetMessage, setWidgetMessage] = useState('')
  async function addWidget(name: typeof WIDGET_NAMES[number]) {
    try {
      const supported = await pinWidget(name)
      setWidgetMessage(supported ? 'Confirme a inclusão na tela inicial do celular.' : 'Na tela inicial, segure um espaço vazio, abra Widgets e procure Lokos de S.I.')
    } catch { setWidgetMessage('Não foi possível adicionar. Na tela inicial, segure um espaço vazio e procure o app em Widgets.') }
  }

  const refresh = useCallback(async () => setReminders(await reminderStatus()), [])
  useEffect(() => {
    void refresh()
  }, [refresh])

  async function toggle(value: boolean) {
    setBusy(true); setMessage('')
    try {
      await setEnabled(value)
      const result = await syncReminders()
      setReminders(result); setMessage(result.error ?? '')
      onRemindersChanged?.()
    } catch (err) { setMessage(errorMessage(err)) } finally { setBusy(false) }
  }

  async function syncNow() {
    setBusy(true); setMessage('')
    try {
      const result = await syncReminders()
      setReminders(result)
      setMessage(result.error ?? (result.permission ? result.scheduled + ' aviso(s) agendado(s) para os próximos dias.' : 'Libere os avisos nas configurações do celular.'))
    } catch (err) { setMessage(errorMessage(err)) } finally { setBusy(false) }
  }

  async function test() {
    setBusy(true)
    try {
      const ok = await sendTestReminder()
      setMessage(ok ? 'Aviso de teste enviado: ele chega em 5 segundos.' : 'Libere os avisos nas configurações do celular.')
    } catch (err) { setMessage(errorMessage(err)) } finally { setBusy(false) }
  }

  if (editingProfile) return <OnboardingScreen remindersEnabled={reminders?.enabled ?? true} name={profile.name} initial={profile} onCancel={() => setEditingProfile(false)} onSave={async (input, enabled) => { await save(input); await setEnabled(enabled); setEditingProfile(false); void loadCards(); void syncReminders(); onRemindersChanged?.() }} />
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
          {profile.photo ? <Image source={{ uri: profile.photo }} style={{ width: 44, height: 44, borderRadius: 22 }} /> : <Text style={styles.avatarText}>{profile.name.charAt(0).toUpperCase()}</Text>}
        </View>
        <View style={styles.cardBody}>
          <Text style={styles.name}>{profile.name}</Text>
          {user?.email ? <Text style={styles.meta}>{user.email}</Text> : null}
        </View>
      </View>

      <Pressable accessibilityRole="button" onPress={() => setEditingProfile(true)} style={styles.card}><MaterialCommunityIcons name="pencil-outline" size={20} color={colors.text} /><View style={styles.cardBody}><Text style={styles.name}>Editar perfil financeiro</Text><Text style={styles.meta}>Recebo dia {profile.salary_day} · Contas dia {profile.bills_day}</Text><Text style={styles.meta}>Novo ciclo dia {profile.cycle_day}</Text></View></Pressable>
      <View style={[styles.card, styles.column]}><Text style={styles.name}>Meus cartões</Text>{cards.map((card) => <View key={card.id} style={styles.row}><MaterialCommunityIcons name="credit-card-outline" size={20} color={colors.muted} /><View style={styles.cardBody}><Text style={styles.value}>{cardLabel(card)}</Text><Text style={styles.meta}>Saldo dos registros: {brl(card.balance ?? 0)}</Text></View></View>)}<Text style={styles.note}>Saldo calculado pelas receitas e despesas registradas. Não consulta o saldo ou limite do banco.</Text><Pressable accessibilityRole="button" style={styles.action} onPress={() => setCardForm(true)}><Text style={styles.actionText}>+ Adicionar cartão</Text></Pressable></View>
      <CardFormModal visible={cardForm} onClose={() => setCardForm(false)} onSaved={() => void loadCards()} />
      <View style={styles.card}>
        <MaterialCommunityIcons name="server-network" size={24} color={colors.muted} />
        <View style={styles.cardBody}>
          <Text style={styles.meta}>Servidor</Text>
          <Text style={styles.value} selectable>
            {server}
          </Text>
        </View>
      </View>

      {widgetsSupported ? <View style={[styles.card, styles.column]}>
        <Text style={styles.name}>Widgets na tela inicial</Text>
        <Text style={styles.note}>Saldo e lançamentos visíveis sem abrir o app. Toque em um dia para consultar os detalhes; use os atalhos para registrar receitas e despesas.</Text>
        {WIDGET_NAMES.map((name, index) => <Pressable key={name} accessibilityRole="button" style={styles.action} onPress={() => void addWidget(name)}><MaterialCommunityIcons name="widgets-outline" size={18} color={colors.text} /><Text style={styles.actionText}>{index === 0 ? 'Adicionar resumo financeiro' : 'Adicionar agenda do mês'}</Text></Pressable>)}
        <Text style={styles.note}>Atualiza ao abrir o app, salvar um lançamento ou tocar em Atualizar. A atualização em segundo plano depende do Android. Dias futuros mostram valores previstos.</Text>
        {widgetMessage ? <Text accessibilityLiveRegion="polite" style={styles.note}>{widgetMessage}</Text> : null}
      </View> : null}
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

      {/* Lembretes e avisos financeiros */}
      <View style={[styles.card, styles.column]}>
        <View style={styles.row}>
          <MaterialCommunityIcons name="bell-ring-outline" size={24} color={colors.muted} />
          <View style={styles.cardBody}>
            <Text style={styles.name}>Lembretes e avisos financeiros</Text>
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
