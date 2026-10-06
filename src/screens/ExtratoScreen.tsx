import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dateShort, resolvePeriod } from '../calendarUtils'
import type { ExtratoFilter, ExtratoPeriod, ExtratoType } from '../calendarUtils'
import { errorMessage, getCashflow, listTransactions } from '../api'
import { Chip } from '../components/Chip'
import { DateSheet } from '../components/DateSheet'
import { NoticeBanner } from '../components/NoticeBanner'
import { TransactionRow } from '../components/TransactionRow'
import { brl, todayIso } from '../format'
import { tap } from '../haptics'
import { colors, radius } from '../theme'
import { confirmDeleteTransaction } from '../transactionActions'
import type { Cashflow, Transaction } from '../types'

const PAGE_SIZE = 50

const TYPES: { id: ExtratoType; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'income', label: 'Receitas' },
  { id: 'expense', label: 'Despesas' },
]
const PERIODS: { id: Exclude<ExtratoPeriod, 'custom'>; label: string }[] = [
  { id: 'month', label: 'Este mês' },
  { id: 'lastMonth', label: 'Mês passado' },
  { id: '30d', label: '30 dias' },
  { id: 'year', label: 'Este ano' },
]

interface Props {
  /** O filtro mora no `Main` (App.tsx): abrir a edição desmonta as abas, e o filtro não pode se perder junto. */
  filter: ExtratoFilter
  onFilterChange: (filter: ExtratoFilter) => void
  /** Muda depois de cada transação nova/editada/apagada: a lista busca de novo. */
  refreshKey: number
  notice: string
  onEdit: (transaction: Transaction) => void
}

/** Aba "Extrato": as transações de um período (Este mês, Mês passado, 30 dias, Este ano ou um período do calendário), filtradas por tipo. */
export function ExtratoScreen({ filter, onFilterChange, refreshKey, notice, onEdit }: Props) {
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<Transaction[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totals, setTotals] = useState<Cashflow | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const requestId = useRef(0)
  const loadingMore = useRef(false)
  const lastKey = useRef('')

  const range = useMemo(() => resolvePeriod(filter, todayIso()), [filter])
  const typeParam = filter.type === 'all' ? undefined : filter.type

  const load = useCallback(async () => {
    const id = ++requestId.current // respostas de um filtro antigo (trocado rápido) são descartadas
    setError('')
    const [page, flow] = await Promise.allSettled([
      listTransactions({ limit: PAGE_SIZE, offset: 0, from: range.from, to: range.to, type: typeParam }),
      getCashflow(range.from, range.to),
    ])
    if (id !== requestId.current) return
    if (page.status === 'fulfilled') {
      setItems(page.value.items)
      setTotal(page.value.total)
    } else {
      setError(errorMessage(page.reason))
    }
    setTotals(flow.status === 'fulfilled' ? flow.value : null) // erro nos totais não esvazia a lista
  }, [range.from, range.to, typeParam])

  useEffect(() => {
    const key = `${range.from}|${range.to}|${typeParam ?? ''}`
    if (key !== lastKey.current) {
      lastKey.current = key
      setItems(null) // filtro novo: volta pro "carregando" (depois de uma edição só atualiza, sem piscar)
      setTotals(null)
    }
    void load()
  }, [load, refreshKey, range.from, range.to, typeParam])

  async function loadMore() {
    if (loadingMore.current || items === null || items.length >= total) return
    loadingMore.current = true
    const id = requestId.current
    try {
      const page = await listTransactions({ limit: PAGE_SIZE, offset: items.length, from: range.from, to: range.to, type: typeParam })
      if (id !== requestId.current) return
      setItems((current) => {
        const seen = new Set((current ?? []).map((t) => t.id))
        return [...(current ?? []), ...page.items.filter((t) => !seen.has(t.id))]
      })
      setTotal(page.total)
    } catch {
      /* a lista que já está na tela continua; puxar para atualizar tenta de novo */
    } finally {
      loadingMore.current = false
    }
  }

  async function onRefresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const customLabel = filter.period === 'custom' && filter.from && filter.to ? `${dateShort(filter.from)} – ${dateShort(filter.to)}` : 'Escolher período'

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Extrato</Text>

      <View style={styles.chips}>
        {TYPES.map((option) => (
          <Chip key={option.id} label={option.label} selected={filter.type === option.id} onPress={() => onFilterChange({ ...filter, type: option.id })} />
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.periodRow}>
        {PERIODS.map((option) => (
          <Chip key={option.id} label={option.label} selected={filter.period === option.id} onPress={() => onFilterChange({ ...filter, period: option.id })} />
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Escolher um período no calendário"
          onPress={() => {
            tap()
            setSheetOpen(true)
          }}
          style={[styles.customButton, filter.period === 'custom' && styles.customButtonOn]}
        >
          <MaterialCommunityIcons name="calendar-range" size={20} color={colors.text} />
          <Text style={styles.customText}>{customLabel}</Text>
        </Pressable>
      </ScrollView>

      <View style={styles.totalsCard}>
        <View style={styles.totalsRow}>
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>Receitas</Text>
            <Text style={[styles.totalValue, { color: colors.income }]} adjustsFontSizeToFit numberOfLines={1}>
              {totals ? brl(totals.income) : '—'}
            </Text>
          </View>
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>Despesas</Text>
            <Text style={[styles.totalValue, { color: colors.expense }]} adjustsFontSizeToFit numberOfLines={1}>
              {totals ? brl(totals.expense) : '—'}
            </Text>
          </View>
          <View style={styles.totalCol}>
            <Text style={styles.totalLabel}>Saldo</Text>
            <Text style={[styles.totalValue, totals && totals.income - totals.expense < 0 && { color: colors.expense }]} adjustsFontSizeToFit numberOfLines={1}>
              {totals ? brl(totals.income - totals.expense) : '—'}
            </Text>
          </View>
        </View>
        <Text style={styles.totalsHint}>
          {dateShort(range.from)} a {dateShort(range.to)} · {items === null ? '…' : total === 1 ? '1 transação' : `${total} transações`}
        </Text>
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
          error ? (
            <Pressable onPress={() => void load()} style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <Text style={styles.errorAction}>Tocar para tentar de novo</Text>
            </Pressable>
          ) : items === null ? (
            <ActivityIndicator color={colors.muted} style={styles.center} />
          ) : (
            <Text style={styles.empty}>Nenhuma transação neste período. Troque o período ou o tipo acima.</Text>
          )
        }
        ListFooterComponent={items !== null && items.length < total ? <ActivityIndicator color={colors.muted} style={styles.footer} /> : <View style={styles.footer} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 12 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.muted} colors={[colors.muted]} progressBackgroundColor={colors.card} />}
      />

      <NoticeBanner notice={notice} />

      <DateSheet
        mode="range"
        visible={sheetOpen}
        title="Escolher período"
        value={filter.period === 'custom' && filter.from && filter.to ? { from: filter.from, to: filter.to } : null}
        onConfirm={(from, to) => {
          setSheetOpen(false)
          onFilterChange({ ...filter, period: 'custom', from, to })
        }}
        onClose={() => setSheetOpen(false)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 16 },
  header: { gap: 12, marginBottom: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  periodRow: { gap: 8, paddingRight: 8 },
  customButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  customButtonOn: { borderColor: colors.text, backgroundColor: `${colors.text}22` },
  customText: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  totalsCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
  totalsRow: { flexDirection: 'row', gap: 8 },
  totalCol: { flex: 1 },
  totalLabel: { color: colors.muted, fontSize: 12 },
  totalValue: { color: colors.text, fontSize: 17, fontWeight: '700', marginTop: 2, fontVariant: ['tabular-nums'] },
  totalsHint: { color: colors.faint, fontSize: 12 },
  center: { marginTop: 32 },
  empty: { color: colors.faint, fontSize: 15, textAlign: 'center', marginTop: 28, paddingHorizontal: 24, lineHeight: 22 },
  errorBox: { marginTop: 16, padding: 14, borderRadius: radius.md, backgroundColor: colors.card },
  errorText: { color: colors.expense, fontSize: 14, lineHeight: 20 },
  errorAction: { color: colors.muted, fontSize: 13, marginTop: 6 },
  footer: { height: 40, justifyContent: 'center' },
})
