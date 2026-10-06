import { MaterialCommunityIcons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, AppState, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { AuthProvider, useAuth } from './src/auth'
import { DEFAULT_EXTRATO } from './src/calendarUtils'
import type { ExtratoFilter, ExtratoType } from './src/calendarUtils'
import type { IconName } from './src/categoryIcons'
import { syncReminders } from './src/reminders'
import { AccountScreen } from './src/screens/AccountScreen'
import { AgendaScreen } from './src/screens/AgendaScreen'
import { BalanceDetailsScreen } from './src/screens/BalanceDetailsScreen'
import { ExtratoScreen } from './src/screens/ExtratoScreen'
import { FinanceScreen } from './src/screens/FinanceScreen'
import { LoginScreen } from './src/screens/LoginScreen'
import { NewAgendaItemScreen } from './src/screens/NewAgendaItemScreen'
import { NewTransactionScreen } from './src/screens/NewTransactionScreen'
import { colors } from './src/theme'
import type { Transaction } from './src/types'

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
  const [tab, setTab] = useState<Tab>('financas')
  const [creating, setCreating] = useState<Creating>(null)
  /** Transação tocada na lista, para ver/editar (valor, descrição, repetição...); null = nenhuma aberta. */
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null)
  /** O filtro do Extrato mora aqui (e não na tela): abrir a edição troca a tela inteira e desmonta as abas. */
  const [extrato, setExtrato] = useState<ExtratoFilter>(DEFAULT_EXTRATO)
  const [balanceOpen, setBalanceOpen] = useState(false)
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
    if (!creating && !editingTransaction && !balanceOpen) return
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setCreating(null)
      setEditingTransaction(null)
      setBalanceOpen(false)
      return true
    })
    return () => subscription.remove()
  }, [creating, editingTransaction, balanceOpen])

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
          />
        ) : tab === 'extrato' ? (
          <ExtratoScreen filter={extrato} onFilterChange={setExtrato} refreshKey={financeKey} notice={notice} onEdit={setEditingTransaction} />
        ) : tab === 'agenda' ? (
          <AgendaScreen refreshKey={agendaKey} notice={notice} onNew={() => setCreating('agenda')} onChanged={agendaChanged} />
        ) : (
          <AccountScreen onRemindersChanged={agendaChanged} />
        )}
      </View>
      <View style={[styles.tabBar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
        {TABS.map((item) => {
          const active = tab === item.id
          return (
            <Pressable key={item.id} onPress={() => setTab(item.id)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={styles.tab}>
              <MaterialCommunityIcons name={active ? item.on : item.off} size={26} color={active ? colors.text : colors.faint} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{item.label}</Text>
            </Pressable>
          )
        })}
      </View>
    </View>
  )
}

function Root() {
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

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="light" />
        <Root />
      </AuthProvider>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 10, gap: 2 },
  tabLabel: { color: colors.faint, fontSize: 12, fontWeight: '600' },
  tabLabelActive: { color: colors.text },
})
