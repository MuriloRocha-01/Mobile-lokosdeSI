import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { shiftMonth } from '../utils/calendarUtils'
import { errorMessage, getSummary } from '../services/api'
import { CategoryBadge } from '../components/CategoryBadge'
import { brl, monthTitle, pct, todayIso } from '../utils/format'
import { tap } from '../utils/haptics'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { FinanceSummary } from '../@types/api'

const monthOf = (year: number, month0: number) => `${String(year).padStart(4, '0')}-${String(month0 + 1).padStart(2, '0')}`

/** Cor da variação %: para receita/saldo subir é bom (verde); para despesa subir é ruim (vermelho). `null` = sem base. */
function changeColor(colors: ThemeColors, value: number | null, goodWhenUp: boolean): string {
  if (value === null || value === 0) return colors.faint
  return value > 0 === goodWhenUp ? colors.income : colors.expense
}

/** Detalhes do "Saldo atual": o mês escolhido (‹ ›), comparação com o mês anterior, quanto sobrou e para onde foi o dinheiro. */
export function BalanceDetailsScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const insets = useSafeAreaInsets()
  const currentMonth = todayIso().slice(0, 7)
  const [month, setMonth] = useState(currentMonth)
  const [summary, setSummary] = useState<FinanceSummary | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async (target: string) => {
    setError('')
    setSummary(null)
    try {
      setSummary(await getSummary(target))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load(month)
  }, [load, month])

  function step(delta: number) {
    const [year, number] = month.split('-').map(Number)
    const next = shiftMonth(year, number - 1, delta)
    const target = monthOf(next.year, next.month0)
    if (target > currentMonth) return
    tap()
    setMonth(target)
  }

  const atCurrent = month >= currentMonth

  return (
    <View style={styles.root}>
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={12} style={styles.close}>
          <MaterialCommunityIcons name="arrow-left" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.heading}>Detalhes do saldo</Text>
        <View style={styles.close} />
      </View>

      <View style={styles.stepper}>
        <Pressable onPress={() => step(-1)} accessibilityRole="button" accessibilityLabel="Mês anterior" hitSlop={10} style={styles.stepButton}>
          <MaterialCommunityIcons name="chevron-left" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.month}>{monthTitle(month)}</Text>
        <Pressable onPress={() => step(1)} disabled={atCurrent} accessibilityRole="button" accessibilityLabel="Próximo mês" hitSlop={10} style={[styles.stepButton, atCurrent && styles.stepOff]}>
          <MaterialCommunityIcons name="chevron-right" size={28} color={colors.text} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 24 }]}>
        {error ? (
          <Pressable onPress={() => void load(month)} style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorAction}>Tocar para tentar de novo</Text>
          </Pressable>
        ) : summary === null ? (
          <ActivityIndicator color={colors.muted} style={styles.loading} />
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.label}>Saldo acumulado</Text>
              <Text style={styles.big} adjustsFontSizeToFit numberOfLines={1}>
                {brl(summary.balance)}
              </Text>
              <Text style={styles.hint}>Tudo que entrou menos tudo que saiu, até o fim de {monthTitle(summary.month)} (inclui lançamentos com data ainda no futuro, dentro do mês).</Text>
              <Text style={[styles.change, { color: changeColor(colors, summary.balance_change, true) }]}>{pct(summary.balance_change)} em relação ao mês anterior</Text>
            </View>

            <View style={styles.pair}>
              <View style={[styles.miniCard, { borderColor: `${colors.income}40` }]}>
                <Text style={styles.label}>Receitas do mês</Text>
                <Text style={[styles.mid, { color: colors.income }]} adjustsFontSizeToFit numberOfLines={1}>
                  {brl(summary.income)}
                </Text>
                <Text style={[styles.change, { color: changeColor(colors, summary.income_change, true) }]}>{pct(summary.income_change)}</Text>
              </View>
              <View style={[styles.miniCard, { borderColor: `${colors.expense}40` }]}>
                <Text style={styles.label}>Despesas do mês</Text>
                <Text style={[styles.mid, { color: colors.expense }]} adjustsFontSizeToFit numberOfLines={1}>
                  {brl(summary.expense)}
                </Text>
                <Text style={[styles.change, { color: changeColor(colors, summary.expense_change, false) }]}>{pct(summary.expense_change)}</Text>
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>{summary.month_balance >= 0 ? 'Sobrou no mês' : 'Faltou no mês'}</Text>
                <Text style={[styles.statValue, { color: summary.month_balance >= 0 ? colors.income : colors.expense }]}>{brl(summary.month_balance)}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Guardado da receita</Text>
                <Text style={styles.statValue}>{summary.savings_rate === null ? '—' : `${summary.savings_rate.toFixed(1).replace('.', ',')}%`}</Text>
              </View>
              <View style={styles.divider} />
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>Lançamentos no mês</Text>
                <Text style={styles.statValue}>{summary.transaction_count}</Text>
              </View>
            </View>

            <Text style={styles.section}>Despesas por categoria</Text>
            {summary.expenses_by_category.length === 0 ? (
              <Text style={styles.empty}>Nenhuma despesa neste mês.</Text>
            ) : (
              <View style={styles.card}>
                {summary.expenses_by_category.map((share) => (
                  <View key={share.category_id} style={styles.shareRow}>
                    <View style={[styles.shareIcon, { backgroundColor: `${share.color}26` }]}>
                      <CategoryBadge icon={share.icon} color={share.color} size={20} />
                    </View>
                    <View style={styles.shareBody}>
                      <View style={styles.shareTop}>
                        <Text style={styles.shareName} numberOfLines={1}>
                          {share.name}
                        </Text>
                        <Text style={styles.shareTotal}>{brl(share.total)}</Text>
                      </View>
                      <View style={styles.bar}>
                        <View style={[styles.barFill, { width: `${Math.max(2, Math.min(100, share.percent))}%`, backgroundColor: share.color }]} />
                      </View>
                      <Text style={styles.sharePercent}>{share.percent.toFixed(1).replace('.', ',')}% das despesas</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8 },
  stepButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  stepOff: { opacity: 0.25 },
  month: { color: colors.text, fontSize: 18, fontWeight: '700', minWidth: 190, textAlign: 'center' },
  content: { paddingHorizontal: 16, gap: 12 },
  loading: { marginTop: 40 },
  errorBox: { padding: 14, borderRadius: radius.md, backgroundColor: colors.card },
  errorText: { color: colors.expense, fontSize: 14, lineHeight: 20 },
  errorAction: { color: colors.muted, fontSize: 13, marginTop: 6 },
  card: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 16, borderWidth: 1, borderColor: colors.border, gap: 4 },
  pair: { flexDirection: 'row', gap: 12 },
  miniCard: { flex: 1, backgroundColor: colors.card, borderRadius: radius.lg, padding: 14, borderWidth: 1 },
  label: { color: colors.muted, fontSize: 13 },
  big: { color: colors.text, fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  mid: { fontSize: 20, fontWeight: '700', marginTop: 6, fontVariant: ['tabular-nums'] },
  hint: { color: colors.faint, fontSize: 12, lineHeight: 17, marginTop: 4 },
  change: { fontSize: 13, fontWeight: '600', marginTop: 6 },
  statRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  statLabel: { color: colors.muted, fontSize: 15 },
  statValue: { color: colors.text, fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border },
  section: { color: colors.text, fontSize: 18, fontWeight: '600', marginTop: 8 },
  empty: { color: colors.faint, fontSize: 15, textAlign: 'center', paddingVertical: 12 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  shareIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  shareBody: { flex: 1, gap: 4 },
  shareTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  shareName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: '600' },
  shareTotal: { color: colors.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.cardHigh, overflow: 'hidden' },
  barFill: { height: 6, borderRadius: 3 },
  sharePercent: { color: colors.faint, fontSize: 12 },
})
