import { SpendingChart } from '../components/SpendingChart'
import { CategoryBadge } from '../components/CategoryBadge'
import { transactionSections } from '../transactionSections'
import { TransactionDayHeader } from '../components/TransactionDayHeader'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Image, SectionList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { ExtratoType } from '../calendarUtils'
import { errorMessage, getFinanceOverview, getCards, getCycleSummary, listTransactions } from '../api'
import { Chip } from '../components/Chip'
import { useProfile } from '../profile'
import { cardLabel } from '../payment'
import { dateBr } from '../calendarUtils'
import { NoticeBanner } from '../components/NoticeBanner'
import { TransactionRow } from '../components/TransactionRow'
import { brl, monthTitle, todayIso } from '../format'
import { tap } from '../haptics'
import { colors, radius } from '../theme'
import { confirmDeleteTransaction } from '../transactionActions'
import type { FinanceOverview, FinanceCard, FinanceSummary, Transaction } from '../types'

interface Props {
  /** Muda depois de cada transação nova/editada/apagada: a lista busca de novo. */
  refreshKey: number
  /** Frase de confirmação ("Despesa de R$ 12,50 salva"), mostrada por alguns segundos. */
  notice: string
  onOpenCategory: (categoryId: number, from?: string, to?: string, cardId?: number) => void
  onOpenPlanning: () => void
  onOpenAccount: () => void
  onNew: () => void
  /** Tocou numa transação: abre pra ver/editar (valor, descrição, repetição...). */
  onEdit: (transaction: Transaction) => void
  /** Tocou em "Saldo atual": os detalhes do saldo e do mês. */
  onOpenBalance: (cardId?: number) => void
  /** Tocou em Receitas/Despesas (ou "Ver tudo"): abre o Extrato já filtrado. */
  onOpenExtrato: (type: ExtratoType, cardId?: number, from?: string, to?: string) => void
}

export const FAB_SIZE = 56

/** Aba "Finanças": o resumo do mês (os três cartões abrem os detalhes), as últimas transações e o botão "+" para lançar. */
export function FinanceScreen({ refreshKey, notice, onNew, onOpenPlanning, onOpenAccount, onOpenCategory, onEdit, onOpenBalance, onOpenExtrato }: Props) {
  const insets = useSafeAreaInsets()
  const { profile } = useProfile()
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [cards, setCards] = useState<FinanceCard[]>([])
  const [cardId, setCardId] = useState<number>()
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [items, setItems] = useState<Transaction[] | null>(null)
  const [chartRevision, setChartRevision] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const request = useRef(0)
  const load = useCallback(async () => {
    const current = ++request.current
    setSummary(null); setItems(null)
    setError('')
    try {
      const [nextSummary, page, nextCards, nextOverview] = await Promise.all([getCycleSummary(todayIso(), cardId), listTransactions({ limit: 15, card_id: cardId }), getCards(todayIso()), getFinanceOverview(todayIso())])
      if (current !== request.current) return
      setOverview(nextOverview)
      setCards(nextCards)
      setSummary(nextSummary)
      setItems(page.items)
      setChartRevision(value => value + 1)
    } catch (err) {
      if (current === request.current) setError(errorMessage(err))
    }
  }, [cardId, profile.cycle_day])

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
      <View style={styles.welcome}>
        <Pressable accessibilityRole="button" accessibilityLabel="Abrir meu perfil" onPress={onOpenAccount} style={styles.avatar}>
          {profile.photo ? <Image source={{ uri: profile.photo }} style={styles.avatarImage} /> : <Text style={styles.avatarLetter}>{profile.name.charAt(0).toUpperCase()}</Text>}
        </Pressable>
        <View style={{ flex: 1 }}><Text style={styles.welcomeDate}>{dateBr(todayIso())}</Text><Text style={styles.greeting}>Olá, {profile.name.split(' ')[0]}</Text></View>
        <Pressable accessibilityRole="button" accessibilityLabel="Consultar extrato" onPress={() => onOpenExtrato('all', cardId)} style={styles.headerAction}><MaterialCommunityIcons name="text-box-search-outline" size={24} color={colors.text} /></Pressable>
      </View>
      <Text style={styles.subtitle}>{summary?.start && summary.end ? 'Ciclo · ' + dateBr(summary.start) + ' a ' + dateBr(summary.end) : ' '}</Text>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}><Chip label="Todos os cartões" selected={cardId === undefined} onPress={() => setCardId(undefined)} />{cards.map((card) => <Chip key={card.id} label={cardLabel(card)} selected={cardId === card.id} onPress={() => setCardId(card.id)} />)}</ScrollView>
      <Pressable onPress={open(() => onOpenBalance(cardId))} accessibilityRole="button" accessibilityLabel="Ver detalhes do saldo" style={({ pressed }) => [styles.balanceCard, pressed && styles.pressed]}>
        <View style={styles.cardTop}>
          <Text style={styles.balanceLabel}>Saldo realizado</Text>
          <MaterialCommunityIcons name="chevron-right" size={20} color={colors.faint} />
        </View>
        <Text style={styles.balance} adjustsFontSizeToFit numberOfLines={1}>
          {summary ? brl(summary.balance) : '—'}
        </Text>
        <View style={styles.balanceFooter}><Text style={styles.balanceHint}>Ver detalhes do saldo</Text><MaterialCommunityIcons name="arrow-top-right" size={18} color="#ffffff" /></View>
      </Pressable>

      {overview && cardId === undefined && <View style={styles.sectionRow}><Text style={styles.welcomeDate}>Reservado: {brl(overview.reserved)}</Text><Text style={[styles.welcomeDate, { color: overview.available < 0 ? colors.expense : colors.income }]}>Livre: {brl(overview.available)}</Text></View>}
      <View style={styles.pair}>
        <Pressable onPress={open(() => onOpenExtrato('income', cardId, summary?.start, summary?.end))} accessibilityRole="button" accessibilityLabel="Ver as receitas do mês" style={({ pressed }) => [styles.miniCard, { borderColor: `${colors.income}40` }, pressed && styles.pressed]}>
          <View style={styles.miniHead}>
            <MaterialCommunityIcons name="arrow-down-circle" size={18} color={colors.income} />
            <Text style={styles.cardLabel}>Receitas</Text>
            <MaterialCommunityIcons name="chevron-right" size={18} color={colors.faint} style={styles.miniChevron} />
          </View>
          <Text style={[styles.miniValue, { color: colors.income }]} adjustsFontSizeToFit numberOfLines={1}>
            {summary ? brl(summary.income) : '—'}
          </Text>
        </Pressable>
        <Pressable onPress={open(() => onOpenExtrato('expense', cardId, summary?.start, summary?.end))} accessibilityRole="button" accessibilityLabel="Ver as despesas do mês" style={({ pressed }) => [styles.miniCard, { borderColor: `${colors.expense}40` }, pressed && styles.pressed]}>
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

      {summary && summary.expenses_by_category.length > 0 && <View style={styles.categoriesCard}>
        <View style={styles.sectionRow}><Text style={styles.section}>Onde você gastou</Text><Text style={styles.welcomeDate}>Neste ciclo</Text></View>
        <View style={styles.distribution}>{summary.expenses_by_category.filter(share => share.total > 0).map(share => <View key={share.category_id} style={{ flex: share.total, backgroundColor: share.color, height: 7 }} />)}</View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 20, paddingVertical: 8 }}>
          {summary.expenses_by_category.map(share => <Pressable key={share.category_id} accessibilityRole="button" accessibilityLabel={'Ver gastos em ' + share.name} onPress={() => onOpenCategory(share.category_id, summary.start, summary.end, cardId)} style={styles.categoryTile}>
            <View style={[styles.categoryIcon, { backgroundColor: share.color + '18' }]}><CategoryBadge icon={share.icon} color={share.color} size={23} /></View>
            <Text style={styles.categoryTileName} numberOfLines={1}>{share.name}</Text><Text style={styles.categoryTileValue}>{brl(share.total)}</Text>
          </Pressable>)}
        </ScrollView>
      </View>}
      <Pressable accessibilityRole="button" onPress={onOpenPlanning} style={styles.categoriesCard}>
        <View style={styles.sectionRow}><Text style={styles.section}>Planejamento</Text><MaterialCommunityIcons name="calendar-clock-outline" size={22} color={colors.text} /></View>
        <Text style={styles.welcomeDate}>Contas · assinaturas · metas · previsão →</Text>
      </Pressable>
      <SpendingChart cardId={cardId} refreshKey={chartRevision} />

      <View style={styles.sectionRow}>
        <Text style={styles.section}>Últimas transações</Text>
        <Pressable onPress={open(() => onOpenExtrato('all', cardId))} accessibilityRole="button" hitSlop={10}>
          <Text style={styles.seeAll}>Ver tudo</Text>
        </Pressable>
      </View>
    </View>
  )

  return (
    <View style={styles.screen}>
      <SectionList
        sections={transactionSections(items ?? [])}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => <TransactionDayHeader date={section.date} />}
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
        <MaterialCommunityIcons name="plus" size={28} color={colors.onPrimary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  welcome: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#e7e2d8', alignItems: 'center', justifyContent: 'center' },
  avatarImage: { width: 46, height: 46, borderRadius: 23 }, avatarLetter: { color: colors.text, fontSize: 22, fontWeight: '600' },
  welcomeDate: { color: colors.muted, fontSize: 12 }, greeting: { color: colors.text, fontSize: 19, fontWeight: '600', marginTop: 4 }, headerAction: { padding: 12 },
  balanceLabel: { color: '#d4d7df', fontSize: 14 }, balanceHint: { color: '#e4e6ed', fontSize: 12 }, balanceFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 },
  categoriesCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 16, gap: 14 },
  distribution: { flexDirection: 'row', borderRadius: 8, overflow: 'hidden', gap: 2 },
  categoryTile: { width: 82, alignItems: 'center', gap: 7 }, categoryIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  categoryTileName: { color: colors.muted, fontSize: 11 }, categoryTileValue: { color: colors.text, fontSize: 12, fontWeight: '600' },
  screen: { flex: 1, backgroundColor: colors.bg },
  list: { paddingHorizontal: 16 },
  header: { gap: 12, marginBottom: 4 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  subtitle: { color: colors.faint, fontSize: 14, marginTop: -8 },
  pressed: { opacity: 0.75 },
  balanceCard: { backgroundColor: '#292e38', borderRadius: radius.xl, padding: 20, borderWidth: 1, borderColor: colors.border },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cardLabel: { color: colors.muted, fontSize: 14 },
  cardHint: { color: colors.faint, fontSize: 12, marginTop: 6 },
  balance: { color: '#ffffff', fontSize: 38, fontWeight: '700', marginTop: 4, fontVariant: ['tabular-nums'] },
  pair: { flexDirection: 'row', gap: 12 },
  miniCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1 },
  miniHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  miniChevron: { marginLeft: 'auto' },
  miniValue: { fontSize: 20, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  sectionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
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
