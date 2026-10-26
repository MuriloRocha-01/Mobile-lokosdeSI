import { transactionSections } from '../utils/transactionSections'
import { TransactionDayHeader } from '../components/TransactionDayHeader'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, SectionList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dateBr, resolvePeriod, shiftMonth } from '../utils/calendarUtils'
import type { ExtratoFilter, ExtratoPeriod, ExtratoType } from '../utils/calendarUtils'
import { errorMessage, getCashflow, getCategories, getCards, listTransactions } from '../services/api'
import { CategoryBadge } from '../components/CategoryBadge'
import { PAYMENT_METHODS, cardLabel, paymentLabel } from '../utils/payment'
import { Chip } from '../components/Chip'
import { DateSheet } from '../components/DateSheet'
import { NoticeBanner } from '../components/NoticeBanner'
import { TransactionRow } from '../components/TransactionRow'
import { brl, monthTitle, todayIso } from '../utils/format'
import { tap } from '../utils/haptics'
import { EmptyState } from '../components/EmptyState'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import { confirmDeleteTransaction } from '../utils/transactionActions'
import type { Cashflow, FinanceCard, Transaction, TransactionCategory } from '../@types/api'

const PAGE_SIZE = 50

const TYPES: { id: ExtratoType; label: string }[] = [
  { id: 'all', label: 'Tudo' },
  { id: 'income', label: 'Receitas' },
  { id: 'expense', label: 'Despesas' },
]
const PERIODS: { id: Exclude<ExtratoPeriod, 'custom'>; label: string }[] = [
  { id: 'month', label: 'Mês' },
  { id: 'lastMonth', label: 'Mês passado' },
  { id: '30d', label: '30 dias' },
  { id: 'year', label: 'Ano' },
]

interface Props {
  /** O filtro mora no `Main` (src/routes/AppRoutes.tsx): abrir a edição desmonta as abas, e o filtro não pode se perder junto. */
  filter: ExtratoFilter
  onFilterChange: (filter: ExtratoFilter) => void
  /** Muda depois de cada transação nova/editada/apagada: a lista busca de novo. */
  refreshKey: number
  notice: string
  onEdit: (transaction: Transaction) => void
}

/** Extrato por mês, ano ou intervalo de dias, filtrado por tipo e categoria. */
export function ExtratoScreen({ filter, onFilterChange, refreshKey, notice, onEdit }: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<Transaction[] | null>(null)
  const [total, setTotal] = useState(0)
  const [totals, setTotals] = useState<Cashflow | null>(null)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [categories, setCategories] = useState<TransactionCategory[]>([])
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [cards, setCards] = useState<FinanceCard[]>([])
  const [categoryOpen, setCategoryOpen] = useState(false)
  const [categoryError, setCategoryError] = useState('')
  const requestId = useRef(0)
  const loadingMore = useRef(false)
  const lastKey = useRef('')

  const range = useMemo(() => resolvePeriod(filter, todayIso()), [filter])
  const typeParam = filter.type === 'all' ? undefined : filter.type

  const loadCategories = useCallback(async () => {
    setCategoryError('')
    try { const [categories, cards] = await Promise.all([getCategories(), getCards(todayIso())]); setCategories(categories); setCards(cards) }
    catch (err) { setCategoryError(errorMessage(err)) }
  }, [])
  useEffect(() => { void loadCategories() }, [loadCategories, refreshKey])

  const load = useCallback(async () => {
    const id = ++requestId.current // respostas de um filtro antigo (trocado rápido) são descartadas
    setError('')
    const [page, flow] = await Promise.allSettled([
      listTransactions({ limit: PAGE_SIZE, offset: 0, from: range.from, to: range.to, type: typeParam, category_id: filter.categoryId, payment_method: filter.paymentMethod, card_id: filter.cardId, status: filter.status }),
      getCashflow(range.from, range.to, { by_settlement: filter.status === 'settled', type: typeParam, category_id: filter.categoryId, payment_method: filter.paymentMethod, card_id: filter.cardId, status: filter.status ?? 'all' }),
    ])
    if (id !== requestId.current) return
    if (page.status === 'fulfilled') {
      setItems(page.value.items)
      setTotal(page.value.total)
    } else {
      setError(errorMessage(page.reason))
    }
    setTotals(flow.status === 'fulfilled' ? flow.value : null) // erro nos totais não esvazia a lista
  }, [range.from, range.to, typeParam, filter.categoryId, filter.paymentMethod, filter.cardId, filter.status])

  useEffect(() => {
    const key = `${range.from}|${range.to}|${typeParam ?? ''}|${filter.categoryId ?? ''}|${filter.paymentMethod ?? ''}|${filter.cardId ?? ''}|${filter.status ?? ''}`
    if (key !== lastKey.current) {
      lastKey.current = key
      setItems(null) // filtro novo: volta pro "carregando" (depois de uma edição só atualiza, sem piscar)
      setTotals(null)
    }
    void load()
    return () => { requestId.current++ }
  }, [load, refreshKey, range.from, range.to, typeParam, filter.categoryId, filter.paymentMethod, filter.cardId, filter.status])

  async function loadMore() {
    if (loadingMore.current || items === null || items.length >= total) return
    loadingMore.current = true
    const id = requestId.current
    try {
      const page = await listTransactions({ limit: PAGE_SIZE, offset: items.length, from: range.from, to: range.to, type: typeParam, category_id: filter.categoryId, payment_method: filter.paymentMethod, card_id: filter.cardId, status: filter.status })
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

  const customLabel = filter.period === 'custom' && filter.from && filter.to ? `${dateBr(filter.from)} – ${dateBr(filter.to)}` : 'Escolher período'

  const selectedCategory = categories.find((category) => category.id === filter.categoryId)
  const periodYear = Number(range.from.slice(0, 4))
  const periodMonth = Number(range.from.slice(5, 7)) - 1
  function stepPeriod(delta: number) {
    if (filter.period === 'year') {
      const year = periodYear + delta
      if (year >= 1970 && year <= 2100) onFilterChange({ ...filter, year })
    } else {
      const next = shiftMonth(periodYear, periodMonth, delta)
      if (next.year >= 1970 && next.year <= 2100) onFilterChange({ ...filter, month: String(next.year) + '-' + String(next.month0 + 1).padStart(2, '0') })
    }
  }

  const header = (
    <View style={styles.header}>
      <Text style={styles.title}>Extrato</Text>
      <View style={styles.titleRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Escolher período do extrato" style={styles.periodTrigger} onPress={() => setFiltersOpen(true)}>
          <MaterialCommunityIcons name="calendar-month-outline" size={18} color={colors.muted} />
          <Text style={styles.periodTriggerText}>{filter.period === 'year' ? String(periodYear) : filter.period === 'month' || filter.period === 'lastMonth' ? monthTitle(range.from.slice(0, 7)) : `${dateBr(range.from)} – ${dateBr(range.to)}`}</Text>
          <MaterialCommunityIcons name="chevron-down" size={16} color={colors.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir filtros do extrato" onPress={() => setFiltersOpen(true)} style={styles.filterTrigger}>
          <MaterialCommunityIcons name="filter-variant" size={22} color={colors.text} />
          <Text style={styles.filterTriggerText}>Filtros{[!!filter.status, filter.type !== 'all', filter.categoryId !== undefined, !!filter.paymentMethod, filter.cardId !== undefined].filter(Boolean).length ? ' •' : ''}</Text>
        </Pressable>
      </View>

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
          {items === null ? 'Carregando lançamentos…' : total === 1 ? '1 transação no período' : `${total} transações no período`}
        </Text>
      </View>
    </View>
  )

  return (
    <View style={styles.screen}>
      <SectionList
        sections={transactionSections(items ?? [], filter.status === 'settled')}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <TransactionDayHeader date={section.date} />}
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
            <EmptyState icon="receipt-text-outline" title="Nenhum movimento por aqui" description="Nenhuma transação neste período. Toque em Filtros para ajustar sua busca." />
          )
        }
        ListFooterComponent={items !== null && items.length < total ? <ActivityIndicator color={colors.muted} style={styles.footer} /> : <View style={styles.footer} />}
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        contentContainerStyle={[styles.list, { paddingTop: insets.top + 24 }]}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} tintColor={colors.muted} colors={[colors.muted]} progressBackgroundColor={colors.card} />}
      />

      <NoticeBanner notice={notice || (items !== null ? error : '')} />
      <Modal visible={filtersOpen} transparent animationType="slide" onRequestClose={() => setFiltersOpen(false)}>
        <View style={styles.backdrop}><View style={[styles.categorySheet, { maxHeight: '90%', paddingBottom: Math.max(insets.bottom, 16), marginTop: insets.top + 16 }]}>
          <View style={styles.titleRow}><Text style={styles.periodTitle}>Filtros</Text><Pressable accessibilityRole="button" accessibilityLabel="Fechar filtros" style={styles.stepButton} onPress={() => setFiltersOpen(false)}><MaterialCommunityIcons name="close" size={20} color={colors.text} /></Pressable></View>
          <ScrollView contentContainerStyle={{ gap: 12, paddingVertical: 12 }}>
      <Text style={styles.filterLabel}>Tipo de lançamento</Text>
      <View style={styles.chips}>
        {TYPES.map((option) => (
          <Chip key={option.id} label={option.label} selected={filter.type === option.id} onPress={() => onFilterChange({ ...filter, type: option.id, categoryId: undefined })} />
        ))}
      </View>

      <Text style={styles.filterLabel}>Período</Text>
      <View style={styles.periodRow}>
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
      </View>

      {filter.period === 'month' || filter.period === 'year' ? (
        <View style={styles.periodPicker}>
          <Pressable accessibilityRole="button" accessibilityLabel="Período anterior" disabled={periodYear <= 1970 && (filter.period === 'year' || periodMonth === 0)} onPress={() => stepPeriod(-1)} style={styles.stepButton}>
            <MaterialCommunityIcons name="chevron-left" size={22} color={colors.text} />
          </Pressable>
          <Text style={styles.periodTitle}>{filter.period === 'year' ? periodYear : monthTitle(range.from.slice(0, 7))}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Próximo período" disabled={periodYear >= 2100 && (filter.period === 'year' || periodMonth === 11)} onPress={() => stepPeriod(1)} style={styles.stepButton}>
            <MaterialCommunityIcons name="chevron-right" size={22} color={colors.text} />
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.filterLabel}>Categoria</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Filtrar por categoria" onPress={() => setCategoryOpen(true)} style={styles.categoryButton}>
        <MaterialCommunityIcons name="filter-variant" size={18} color={colors.muted} />
        <Text style={styles.categoryName}>{selectedCategory?.name ?? (filter.categoryId !== undefined ? 'Categoria selecionada' : 'Todas as categorias')}</Text>
        <MaterialCommunityIcons name="chevron-down" size={18} color={colors.muted} />
      </Pressable>

      <Text style={styles.filterLabel}>Forma de pagamento</Text>
      <View style={styles.chips}>
        <Chip label="Todas" selected={!filter.paymentMethod} onPress={() => onFilterChange({ ...filter, paymentMethod: undefined })} />
        {PAYMENT_METHODS.map((method) => <Chip key={method.id} label={method.label} selected={filter.paymentMethod === method.id} onPress={() => onFilterChange({ ...filter, paymentMethod: method.id, cardId: method.id === 'cash' ? undefined : filter.cardId })} />)}
      </View>
      {filter.paymentMethod !== 'cash' && <><Text style={styles.filterLabel}>Cartão</Text><View style={styles.chips}><Chip label="Todos" selected={filter.cardId === undefined} onPress={() => onFilterChange({ ...filter, cardId: undefined })} />{cards.map((card) => <Chip key={card.id} label={cardLabel(card)} selected={filter.cardId === card.id} onPress={() => onFilterChange({ ...filter, cardId: card.id })} />)}</View></>}
      {categoryError ? <Pressable onPress={() => void loadCategories()}><Text style={styles.errorText}>{categoryError} · Tentar novamente</Text></Pressable> : null}

          </ScrollView>
          <Text style={styles.filterTriggerText}>Situação</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Todas" selected={!filter.status} onPress={() => onFilterChange({ ...filter, status: undefined })} />
            <Chip label="Pendentes" selected={filter.status === 'pending'} onPress={() => onFilterChange({ ...filter, status: 'pending' })} />
            <Chip label="Pagas / recebidas" selected={filter.status === 'settled'} onPress={() => onFilterChange({ ...filter, status: 'settled' })} />
          </View>
          <View style={styles.titleRow}><Pressable accessibilityRole="button" onPress={() => onFilterChange({ type: 'all', period: 'month' })} style={styles.clearButton}><Text style={styles.filterTriggerText}>Limpar</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setFiltersOpen(false)} style={styles.applyButton}><Text style={styles.applyText}>Ver resultados</Text></Pressable></View>
      <Modal visible={categoryOpen} transparent animationType="slide" onRequestClose={() => setCategoryOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityLabel="Fechar categorias" onPress={() => setCategoryOpen(false)} />
          <View style={[styles.categorySheet, { paddingBottom: Math.max(insets.bottom, 16), marginTop: insets.top + 16 }]}>
            <View style={styles.periodPicker}>
              <Text style={styles.periodTitle}>Filtrar por categoria</Text>
              <Pressable accessibilityRole="button" accessibilityLabel="Fechar categorias" onPress={() => setCategoryOpen(false)} style={styles.stepButton}><MaterialCommunityIcons name="close" size={20} color={colors.text} /></Pressable>
            </View>
            <ScrollView>
              <Pressable accessibilityRole="radio" accessibilityState={{ checked: filter.categoryId === undefined }} style={styles.categoryButton} onPress={() => { onFilterChange({ ...filter, categoryId: undefined }); setCategoryOpen(false) }}>
                <Text style={styles.categoryName}>Todas as categorias</Text>
                {filter.categoryId === undefined && <MaterialCommunityIcons name="check" size={18} color={colors.text} />}
              </Pressable>
              {categories.filter((category) => filter.type === 'all' || category.type === filter.type).map((category) => (
                <Pressable key={category.id} accessibilityRole="radio" accessibilityState={{ checked: filter.categoryId === category.id }} style={styles.categoryButton} onPress={() => { onFilterChange({ ...filter, categoryId: category.id }); setCategoryOpen(false) }}>
                  <CategoryBadge icon={category.icon} color={category.color} size={18} />
                  <Text style={styles.categoryName}>{category.name}</Text>
                  {filter.categoryId === category.id && <MaterialCommunityIcons name="check" size={18} color={colors.text} />}
                </Pressable>
              ))}
              {categoryError ? <Pressable onPress={() => void loadCategories()} style={styles.errorBox}><Text style={styles.errorText}>{categoryError}</Text><Text style={styles.errorAction}>Tocar para tentar de novo</Text></Pressable> : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

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
        </View></View>
      </Modal>
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  periodTrigger: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, marginRight: 12 },
  periodTriggerText: { flexShrink: 1, color: colors.muted, fontSize: 14 },
  filterTrigger: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 48, paddingHorizontal: 12, borderRadius: 24, backgroundColor: colors.card },
  filterTriggerText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  clearButton: { minHeight: 48, paddingHorizontal: 20, justifyContent: 'center' },
  applyButton: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.primary },
  applyText: { color: colors.onPrimary, fontSize: 15, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  filterLabel: { color: colors.muted, fontSize: 13, fontWeight: '600', marginTop: 8 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.backdrop },
  categorySheet: { maxHeight: '80%', backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  categoryButton: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, minHeight: 48, backgroundColor: colors.card, borderRadius: radius.md },
  categoryName: { flex: 1, color: colors.text, fontSize: 15 },
  periodPicker: { flexDirection: 'row', alignItems: 'center' },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  periodTitle: { flex: 1, color: colors.text, textAlign: 'center', fontSize: 16, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 20 },
  header: { gap: 16, marginBottom: 14 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 14, marginTop: -8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  periodRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  customButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  customButtonOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  customText: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  totalsCard: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1, borderColor: colors.border, gap: 8 },
  totalsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  totalCol: { flex: 1, minWidth: 96 },
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
