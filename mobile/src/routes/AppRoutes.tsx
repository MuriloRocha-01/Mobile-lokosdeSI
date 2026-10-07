import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useAuth } from '../hooks/useAuth'
import { DEFAULT_EXTRATO } from '../utils/calendarUtils'
import type { ExtratoFilter, ExtratoType } from '../utils/calendarUtils'
import type { IconName } from '../utils/categoryIcons'
import { syncReminders } from '../services/reminders'
import { AccountScreen } from '../screens/AccountScreen'
import { AgendaScreen } from '../screens/AgendaScreen'
import { BalanceDetailsScreen } from '../screens/BalanceDetailsScreen'
import { ExtratoScreen } from '../screens/ExtratoScreen'
import { FinanceScreen } from '../screens/FinanceScreen'
import { LoginScreen } from '../screens/LoginScreen'
import { NewAgendaItemScreen } from '../screens/NewAgendaItemScreen'
import { NewTransactionScreen } from '../screens/NewTransactionScreen'
import { ImportStatementScreen } from '../screens/ImportStatementScreen'
import { BankAutomationScreen } from '../screens/BankAutomationScreen'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { Transaction } from '../@types/api'

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
  const { colors, mode } = useTheme()
  const styles = createStyles(colors, mode === 'dark')
  const insets = useSafeAreaInsets()
  const [tab, setTab] = useState<Tab>('financas')
  const [creating, setCreating] = useState<Creating>(null)
  /** Transação tocada na lista, para ver/editar (valor, descrição, repetição...); null = nenhuma aberta. */
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  /** O filtro do Extrato mora aqui (e não na tela): abrir a edição troca a tela inteira e desmonta as abas. */
  const [extrato, setExtrato] = useState<ExtratoFilter>(DEFAULT_EXTRATO)
  const [balanceOpen, setBalanceOpen] = useState(false)
  const [integration, setIntegration] = useState<'import' | 'automation' | null>(null)
  const [financeKey, setFinanceKey] = useState(0)
  const [agendaKey, setAgendaKey] = useState(0)
  const [notice, setNotice] = useState('')

  // Reagenda os lembretes: ao entrar, sempre que o app volta para a tela e depois de qualquer mudança na agenda.
  useEffect(() => {
    void syncReminders()
  }, [agendaKey])
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void syncReminders()
    })
    return () => subscription.remove()
  }, [])

  // O botão "voltar" do Android fecha a tela de "novo"/edição/detalhes em vez de sair do app.
  useEffect(() => {
    if (!creating && !editingTransaction && !balanceOpen && integration !== 'automation') return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setCreating(null)
      setEditingTransaction(null)
      setBalanceOpen(false)
      setIntegration(null)
      return true
    })
    return () => subscription.remove()
  }, [creating, editingTransaction, balanceOpen, integration])

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
  const openExtrato = useCallback((type: ExtratoType) => {
    setExtrato({ type, period: 'month' })
    setTab('extrato')
  }, [])

  if (balanceOpen) return <BalanceDetailsScreen onClose={() => setBalanceOpen(false)} />
  if (integration === 'import') return <ImportStatementScreen onClose={() => { setIntegration(null); setFinanceKey(key => key + 1) }} />
  if (integration === 'automation') return <BankAutomationScreen onClose={() => setIntegration(null)} />
  if (creating === 'transacao' || editingTransaction)
    return (
      <NewTransactionScreen
        transaction={editingTransaction}
        onClose={() => {
          setCreating(null)
          setEditingTransaction(null)
        }}
        onSaved={(message) => {
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
            onNew={() => setCreating('transacao')}
            onEdit={setEditingTransaction}
            onOpenBalance={() => setBalanceOpen(true)}
            onOpenExtrato={openExtrato}
            onOpenAccount={() => setTab('conta')}
          />
        ) : tab === 'extrato' ? (
          <ExtratoScreen filter={extrato} onFilterChange={setExtrato} refreshKey={financeKey} notice={notice} onEdit={setEditingTransaction} />
        ) : tab === 'agenda' ? (
          <AgendaScreen refreshKey={agendaKey} notice={notice} onNew={() => setCreating('agenda')} onChanged={agendaChanged} />
        ) : (
          <AccountScreen onRemindersChanged={agendaChanged} onImport={() => setIntegration('import')} onBankAutomation={() => setIntegration('automation')} />
        )}
      </View>
      <View style={[styles.tabBar, { paddingBottom: mode === 'dark' ? 8 : Math.max(insets.bottom, 10), marginBottom: mode === 'dark' ? Math.max(insets.bottom, 12) : 0 }]} accessibilityRole="tablist">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <Pressable key={item.id} onPress={() => setTab(item.id)} accessibilityRole="tab" accessibilityLabel={item.label} accessibilityState={{ selected: active }} style={styles.tab}>
              <View style={[styles.tabIcon, active && styles.tabIconActive]}><MaterialCommunityIcons name={active ? item.on : item.off} size={23} color={active ? (mode === 'dark' ? colors.onPrimary : colors.primary) : colors.faint} /></View>
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

export function AppRoutes() {
  const { colors, mode } = useTheme()
  const styles = createStyles(colors, mode === 'dark')
  const { status } = useAuth()
  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.muted} />
      </View>
    )
  }
  return status === 'authenticated' ? <Main /> : <LoginScreen />
}

const createStyles = (colors: ThemeColors, dark: boolean) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  tabBar: { marginHorizontal: dark ? 20 : 0, borderRadius: dark ? 32 : 0, flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: dark ? 0 : 1, borderTopColor: colors.border, paddingHorizontal: 12, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 4, gap: 4, minHeight: 60 },
  tabLabel: { color: colors.faint, fontSize: 12, fontWeight: '600' },
  tabLabelActive: { color: colors.primary, fontWeight: '700' },
  tabIcon: { width: 52, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tabIconActive: { backgroundColor: dark ? colors.primary : colors.primarySoft },
})
