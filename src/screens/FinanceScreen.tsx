import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ExtratoType } from '../calendarUtils'
import { errorMessage, getSummary, listTransactions } from '../api'
import { NoticeBanner } from '../components/NoticeBanner'
import { TransactionRow } from '../components/TransactionRow'
import { brl, monthTitle, todayIso } from '../format'
import { tap } from '../haptics'
import { colors, radius } from '../theme'
import { confirmDeleteTransaction } from '../transactionActions'
import type { FinanceSummary, Transaction } from '../types'

interface Props {
  /** Muda depois de cada transação nova/editada/apagada: a lista busca de novo. */
  refreshKey: number
  /** Frase de confirmação ("Despesa de R$ 12,50 salva"), mostrada por alguns segundos. */
  notice: string
  onNew: () => void
  /** Tocou numa transação: abre pra ver/editar (valor, descrição, repetição...). */
  onEdit: (transaction: Transaction) => void
  /** Tocou em "Saldo atual": os detalhes do saldo e do mês. */
  onOpenBalance: () => void
  /** Tocou em Receitas/Despesas (ou "Ver tudo"): abre o Extrato já filtrado. */
  onOpenExtrato: (type: ExtratoType) => void
}

export const FAB_SIZE = 76

/** Aba "Finanças": o resumo do mês (os três cartões abrem os detalhes), as últimas transações e o botão "+" para lançar. */
export function FinanceScreen({ refreshKey, notice, onNew, onEdit, onOpenBalance, onOpenExtrato }: Props) {
  const insets = useSafeAreaInsets()
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [items, setItems] = useState<Transaction[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const [nextSummary, page] = await Promise.all([getSummary(todayIso().slice(0, 7)), listTransactions({ limit: 15 })])
      setSummary(nextSummary)
      setItems(page.items)
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const open = (action: () => void) => () => {
    tap()
    action()
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Finanças</Text>
      <Text style={styles.subtitle}>{summary ? monthTitle(summary.month) : ' '}</Text>

      <Pressable onPress={open(onOpenBalance)} accessibilityRole="button" accessibilityLabel="Ver detalhes do saldo" style={({ pressed }) => [styles.balanceCard, pressed && styles.pressed]}>
        <View style={styles.cardTop}>
          <Text style={styles.cardLabel}>Saldo atual</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.faint} />
        </View>
        <Text style={styles.balance} adjustsFontSizeToFit numberOfLines={1}>
          {summary ? brl(summary.balance) : '—'}
        </Text>
        <Text style={styles.cardHint}>Toque para ver os detalhes</Text>
      </Pressable>

      <View style={styles.pair}>
        <Pressable onPress={open(() => onOpenExtrato('income'))} accessibilityRole="button" accessibilityLabel="Ver as receitas do mês" style={({ pressed }) => [styles.miniCard, { borderColor: `${colors.income}40` }, pressed && styles.pressed]}>
          <View style={styles.miniHead}>
            <MaterialCommunityIcons name="arrow-down-circle" size={18} color={colors.income} />
            <Text style={styles.cardLabel}>Receitas</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.faint} style={styles.miniChevron} />
          </View>
          <Text style={[styles.miniValue, { color: colors.income }]} adjustsFontSizeToFit numberOfLines={1}>
            {summary ? brl(summary.income) : '—'}
          </Text>
        </Pressable>
        <Pressable onPress={open(() => onOpenExtrato('expense'))} accessibilityRole="button" accessibilityLabel="Ver as despesas do mês" style={({ pressed }) => [styles.miniCard, { borderColor: `${colors.expense}40` }, pressed && styles.pressed]}>
          <View style={styles.miniHead}>
            <MaterialCommunityIcons name="arrow-up-circle" size={18} color={colors.expense} />
            <Text style={styles.cardLabel}>Despesas</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.faint} style={styles.miniChevron} />
          </View>
          <Text style={[styles.miniValue, { color: colors.expense }]} adjustsFontSizeToFit numberOfLines={1}>
            {summary ? brl(summary.expense) : '—'}
          </Text>
        </Pressable>
      </View>

      <View style={styles.sectionRow}>
        <Text style={styles.section}>Últimas transações</Text>
        <Pressable onPress={open(() => onOpenExtrato('all'))} accessibilityRole="button" hitSlop={10}>
          <Text style={styles.seeAll}>Ver tudo</Text>
        </Pressable>
      </View>
    </View>
  )

  return (
    <View style={styles.screen}>
      <FlatList
        data={items ?? []}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => <TransactionRow item={item} onPress={() => onEdit(item)} onLongPress={() => confirmDeleteTransaction(item, () => void load(), setError)} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          items === null && !error ? (
            <ActivityIndicator color={colors.muted} style={styles.center} />
          ) : error ? (
            <Pressable onPress={() => void load()} style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorAction}>Tocar para tentar de novo</Text>
            </Pressable>
          ) : (
            <Text style={styles.empty}>Nenhuma transação ainda. Toque no + para lançar a primeira.</Text>
          )
        }
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 12, paddingBottom: FAB_SIZE + 48 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.muted} colors={[colors.muted]} progressBackgroundColor={colors.card} />}
      />

      <NoticeBanner notice={notice} />

      <Pressable
        onPress={() => {
          tap()
          onNew()
        }}
        accessibilityRole="button"
        accessibilityLabel="Nova transação"
        style={({ pressed }) => [styles.fab, pressed && styles.fabPressed]}
      >
        <MaterialCommunityIcons name="plus" size={44} color={colors.onPrimary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 16 },
  header: { gap: 12, marginBottom: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  subtitle: { color: colors.faint, fontSize: 14, marginTop: -8 },
  pressed: { opacity: 0.75 },
  balanceCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 20, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { color: colors.muted, fontSize: 14 },
  cardHint: { color: colors.faint, fontSize: 12, marginTop: 6 },
  balance: { color: colors.text, fontSize: 38, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  pair: { flexDirection: 'row', gap: 12 },
  miniCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1 },
  miniHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniChevron: { marginLeft: 'auto' },
  miniValue: { fontSize: 20, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  section: { color: colors.text, fontSize: 18, fontWeight: '600' },
  seeAll: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  center: { marginTop: 32 },
  empty: { color: colors.faint, fontSize: 15, textAlign: 'center', marginTop: 28, paddingHorizontal: 24, lineHeight: 22 },
  errorBox: { marginTop: 16, padding: 14, borderRadius: radius.md, backgroundColor: colors.card },
  errorText: { color: colors.expense, fontSize: 14, lineHeight: 20 },
  errorAction: { color: colors.muted, fontSize: 13, marginTop: 6 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  fabPressed: { transform: [{ scale: 0.94 }] },
})
