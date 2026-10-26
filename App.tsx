import { PlanningScreen } from './src/screens/PlanningScreen'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, BackHandler, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { UpdateGate } from './src/components/UpdateGate'
import { ProfileProvider } from './src/profile'
import { AuthProvider, useAuth } from './src/auth'
import { DEFAULT_EXTRATO } from './src/calendarUtils'
import type { ExtratoFilter, ExtratoType } from './src/calendarUtils'
import type { IconName } from './src/categoryIcons'
import type { NotificationResponse } from 'expo-notifications'
import { getReminderAccount, remindersSupported, syncReminders } from './src/reminders'
import { AccountScreen } from './src/screens/AccountScreen'
import { AgendaScreen } from './src/screens/AgendaScreen'
import { BalanceDetailsScreen } from './src/screens/BalanceDetailsScreen'
import { ExtratoScreen } from './src/screens/ExtratoScreen'
import { FinanceScreen } from './src/screens/FinanceScreen'
import { LoginScreen } from './src/screens/LoginScreen'
import { NewAgendaItemScreen } from './src/screens/NewAgendaItemScreen'
import { TransactionDetailsScreen } from './src/screens/TransactionDetailsScreen'
import { NewTransactionScreen } from './src/screens/NewTransactionScreen'
import { colors } from './src/theme'
import { refreshWidgets } from './src/widgets'
import { parseWidgetLink } from './src/widgets/model'
import type { TransactionType, Transaction } from './src/types'

type Tab = 'financas' | 'extrato' | 'agenda' | 'conta'
type Creating = 'transacao' | 'agenda' | null

const TABS: { id: Tab; label: string; on: IconName; off: IconName }[] = [
  { id: 'financas', label: 'Finanças', on: 'wallet', off: 'wallet-outline' },
  { id: 'extrato', label: 'Extrato', on: 'receipt-text', off: 'receipt-text-outline' },
  { id: 'agenda', label: 'Agenda', on: 'calendar-check', off: 'calendar-check-outline' },
  { id: 'conta', label: 'Conta', on: 'account-circle', off: 'account-circle-outline' },
]

/** Depois do login: a barra de abas e, por cima, as telas de "novo" quando o + é tocado. */
function Main() {
  const insets = useSafeAreaInsets()
  const [initialRecurrence, setInitialRecurrence] = useState<'none' | 'monthly'>('none')
  const [initialType, setInitialType] = useState<TransactionType>('expense')
  const [tab, setTab] = useState<Tab>('financas')
  const [creating, setCreating] = useState<Creating>(null)
  /** Transação tocada na lista, para ver/editar (valor, descrição, repetição...); null = nenhuma aberta. */
  const [editMode, setEditMode] = useState(false)
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  /** O filtro do Extrato mora aqui (e não na tela): abrir a edição troca a tela inteira e desmonta as abas. */
  const [extrato, setExtrato] = useState<ExtratoFilter>(DEFAULT_EXTRATO)
  const [balanceCardId, setBalanceCardId] = useState<number>()
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [planningOpen, setPlanningOpen] = useState(false)
  const [financeKey, setFinanceKey] = useState(0)
  const [agendaKey, setAgendaKey] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (!remindersSupported) return
    const Notifications: typeof import('expo-notifications') = require('expo-notifications')
    const openNotification = (response: NotificationResponse | null) => {
      const data = response?.notification.request.content.data
      if (!data || data.account !== getReminderAccount()) return
      if (data.screen === 'agenda' || data.screen === 'financas') {
        setCreating(null); setEditingTransaction(null); setEditMode(false); setBalanceOpen(false); setPlanningOpen(false)
        setTab(data.screen)
        void Notifications.clearLastNotificationResponseAsync()
      }
    }
    const listener = Notifications.addNotificationResponseReceivedListener(openNotification)
    void Notifications.getLastNotificationResponseAsync().then(openNotification)
    return () => listener.remove()
  }, [])

  useEffect(() => { void refreshWidgets().catch(() => {}) }, [financeKey])
  useEffect(() => {
    const open = (url: string | null) => {
      const action = url && parseWidgetLink(url)
      if (!action) return
      setCreating(null); setEditingTransaction(null); setEditMode(false); setBalanceOpen(false); setPlanningOpen(false)
      if ('type' in action) { setInitialRecurrence('none'); setInitialType(action.type); setCreating('transacao') }
      else if ('date' in action) {
        setExtrato({ type: 'all', period: 'custom', from: action.date, to: action.date }); setTab('extrato')
      } else setTab('financas')
    }
    const listener = Linking.addEventListener('url', event => open(event.url))
    void Linking.getInitialURL().then(open).catch(() => {})
    return () => listener.remove()
  }, [])

  // Reagenda os lembretes: ao entrar, sempre que o app volta para a tela e depois de qualquer mudança na agenda.
  useEffect(() => {
    void syncReminders()
  }, [agendaKey])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') { void syncReminders(); setFinanceKey(key => key + 1) }
    })
    return () => subscription.remove()
  }, [])

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      const now = new Date()
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
      timer = setTimeout(() => { setFinanceKey(key => key + 1); setAgendaKey(key => key + 1); schedule() }, next.getTime() - now.getTime() + 1000)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])

  // O botão "voltar" do Android fecha a tela de "novo"/edição/detalhes em vez de sair do app.
  useEffect(() => {
    if (!creating && !editingTransaction && !balanceOpen && !planningOpen) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editMode) { setEditMode(false); return true }
      setCreating(null)
      setEditingTransaction(null)
      setBalanceOpen(false)
      setPlanningOpen(false)
      return true
    })
    return () => subscription.remove()
  }, [creating, editingTransaction, balanceOpen, editMode, planningOpen])

  useEffect(() => {
    if (!notice) return
    const id = setTimeout(() => setNotice(''), 3500)
    return () => clearTimeout(id)
  }, [notice])

  const onSaved = useCallback((kind: Exclude<Creating, null>, message: string) => {
    setCreating(null)
    setNotice(message)
    if (kind === 'transacao') setFinanceKey((key) => key + 1)
    else setAgendaKey((key) => key + 1)
  }, [])

  const agendaChanged = useCallback(() => setAgendaKey((key) => key + 1), [])

  /** Receitas/Despesas/"Ver tudo" da tela Finanças: vai para o Extrato já filtrado, no mês atual. */
  const openExtrato = useCallback((type: ExtratoType, cardId?: number, from?: string, to?: string) => {
    setExtrato({ type, cardId, status: type === 'all' ? undefined : 'settled', period: from && to ? 'custom' : 'month', from, to })
    setTab('extrato')
  }, [])

  if (planningOpen) return <PlanningScreen onClose={() => setPlanningOpen(false)} onChanged={() => setFinanceKey(key => key + 1)} onOpen={item => { setPlanningOpen(false); setEditingTransaction(item) }} onNew={() => { setPlanningOpen(false); setInitialType('expense'); setInitialRecurrence('monthly'); setCreating('transacao') }} />
  if (balanceOpen) return <BalanceDetailsScreen cardId={balanceCardId} onOpenCard={(cardId, from, to) => { setBalanceOpen(false); openExtrato('expense', cardId, from, to) }} onClose={() => setBalanceOpen(false)} onOpenCategory={(categoryId, month, from, to) => {
    setExtrato({ type: 'expense', status: 'settled', period: from && to ? 'custom' : 'month', month, from, to, categoryId, cardId: balanceCardId })
    setBalanceOpen(false)
    setTab('extrato')
  }} />
  if (editingTransaction && !editMode) return <TransactionDetailsScreen transaction={editingTransaction} onClose={() => setEditingTransaction(null)} onEdit={() => setEditMode(true)} onChanged={item => { setEditingTransaction(item); setFinanceKey(key => key + 1) }} onDeleted={() => { setEditingTransaction(null); setFinanceKey(key => key + 1); setNotice('Lançamento excluído') }} />
  if (creating === 'transacao' || editingTransaction)
    return (
      <NewTransactionScreen
        key={editingTransaction?.id ?? initialType}
        initialType={initialType}
        initialRecurrence={initialRecurrence}
        transaction={editingTransaction}
        onClose={() => {
          setCreating(null)
          setEditMode(false)
        }}
        onSaved={(message) => {
          setEditMode(false)
          setEditingTransaction(null)
          onSaved('transacao', message)
        }}
      />
    )
  if (creating === 'agenda') return <NewAgendaItemScreen onClose={() => setCreating(null)} onSaved={(message) => onSaved('agenda', message)} />

  return (
    <View style={styles.root}>
      <View style={styles.body}>
        {tab === 'financas' ? (
          <FinanceScreen
            refreshKey={financeKey}
            notice={notice}
            onNew={() => { setInitialRecurrence('none'); setInitialType('expense'); setCreating('transacao') }}
            onEdit={setEditingTransaction}
            onOpenBalance={(cardId) => { setBalanceCardId(cardId); setBalanceOpen(true) }}
            onOpenExtrato={openExtrato}
            onOpenAccount={() => setTab('conta')}
            onOpenPlanning={() => setPlanningOpen(true)}
            onOpenCategory={(categoryId, from, to, cardId) => { setExtrato({ type: 'expense', status: 'settled', categoryId, cardId, period: from && to ? 'custom' : 'month', from, to }); setTab('extrato') }}
          />
        ) : tab === 'extrato' ? (
          <ExtratoScreen filter={extrato} onFilterChange={setExtrato} refreshKey={financeKey} notice={notice} onEdit={setEditingTransaction} />
        ) : tab === 'agenda' ? (
          <AgendaScreen refreshKey={agendaKey} notice={notice} onNew={() => setCreating('agenda')} onChanged={agendaChanged} />
        ) : (
          <AccountScreen onRemindersChanged={agendaChanged} />
        )}
      </View>
      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8), paddingLeft: insets.left, paddingRight: insets.right }]} accessibilityRole="tablist">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <Pressable key={item.id} onPress={() => setTab(item.id)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.tab}>
              <MaterialCommunityIcons name={active ? item.on : item.off} size={22} color={active ? colors.text : colors.faint} />
              <Text numberOfLines={1} style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function Root() {
  const { status, server, user } = useAuth()
  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.muted} />
      </View>
    )
  }
  return status === 'authenticated' ? <ProfileProvider key={server + '|' + user?.id}><Main /></ProfileProvider> : <LoginScreen />
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <UpdateGate><Root /></UpdateGate>
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1, minHeight: 0 },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', flexShrink: 0, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, minWidth: 0, minHeight: 56, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 2 },
  tabLabel: { color: colors.faint, fontSize: 12, fontWeight: '600' },
  tabLabelActive: { color: colors.text },
})
