import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import Svg, { Defs, LinearGradient, Stop, Path, Line } from 'react-native-svg'
import { getCashflow, errorMessage } from '../services/api'
import { dateBr, isoOf, shiftMonth } from '../utils/calendarUtils'
import { brl, monthTitle, todayIso } from '../utils/format'
import { spendingPath, spendingPoints } from '../utils/spendingChart'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { Cashflow } from '../@types/api'
import { DateSheet } from './DateSheet'

export function SpendingChart({ cardId, refreshKey }: { cardId?: number; refreshKey: number }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const today = todayIso()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [mode, setMode] = useState<'month' | 'six' | 'custom'>('month')
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [picker, setPicker] = useState(false)
  const [flow, setFlow] = useState<Cashflow | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const [year, number] = month.split('-').map(Number)
  const first = shiftMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, -5)
  const from = mode === 'six' ? isoOf(first.year, first.month0, 1) : mode === 'custom' && custom ? custom.from : month + '-01'
  const monthEnd = isoOf(year, number - 1, new Date(year, number, 0).getDate())
  const to = mode === 'six' ? today : mode === 'custom' && custom ? custom.to : monthEnd < today ? monthEnd : today
  useEffect(() => {
    let active = true
    setFlow(null); setError('')
    getCashflow(from, to, { card_id: cardId }).then(data => { if (active) setFlow(data) }).catch(err => { if (active) setError(errorMessage(err)) })
    return () => { active = false }
  }, [from, to, cardId, refreshKey, retry])
  const points = spendingPoints(flow?.days ?? [], mode === 'six')
  const path = spendingPath(points)
  const move = (delta: number) => { const next = shiftMonth(year, number - 1, delta); setMonth(isoOf(next.year, next.month0, 1).slice(0, 7)) }
  return <View style={styles.card}>
    <View style={styles.row}><Text style={styles.title}>Seus gastos</Text><MaterialCommunityIcons name="chart-line" size={20} color={colors.expense} /></View>
    <View style={styles.modes}>{(['month', 'six', 'custom'] as const).map((value, i) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: mode === value }} style={[styles.mode, mode === value && styles.selected]} onPress={() => value === 'custom' ? setPicker(true) : setMode(value)}><Text style={[styles.modeText, mode === value && { color: colors.onPrimary }]}>{['Mês', '6 meses', 'Período'][i]}</Text></Pressable>)}</View>
    {mode === 'month' ? <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="Mês anterior dos gastos" disabled={month <= '1970-01'} style={styles.arrow} onPress={() => move(-1)}><MaterialCommunityIcons name="chevron-left" size={22} color={colors.text} /></Pressable>
      <Text style={styles.caption}>{monthTitle(month)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Próximo mês dos gastos" disabled={month >= today.slice(0, 7)} style={styles.arrow} onPress={() => move(1)}><MaterialCommunityIcons name="chevron-right" size={22} color={month >= today.slice(0, 7) ? colors.border : colors.text} /></Pressable>
    </View> : <Text style={styles.caption}>{dateBr(from)} a {dateBr(to)}</Text>}
    {error ? <Pressable accessibilityRole="button" onPress={() => setRetry(n => n + 1)}><Text style={styles.error}>{error} · Tentar novamente</Text></Pressable> : !flow ? <ActivityIndicator style={{ padding: 32 }} color={colors.muted} /> : <>
      <Text style={styles.total}>{brl(flow.expense)}</Text>
      <Text style={styles.caption}>{mode === 'six' ? 'Total de despesas por mês' : 'Despesas por dia'}{mode === 'month' && month === today.slice(0, 7) ? ' · até hoje' : ''}</Text>
      <View accessible accessibilityLabel={points.map(p => `${p.date}: ${brl(p.value)}`).join('; ')}>
        <Svg width="100%" height={136} viewBox="0 0 300 124" preserveAspectRatio="none">
          <Defs><LinearGradient id="spendingFill" x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor="#df8d7d" stopOpacity={0.3} /><Stop offset="1" stopColor="#df8d7d" stopOpacity={0} /></LinearGradient></Defs>
          <Line x1="8" y1="110" x2="292" y2="110" stroke={colors.border} />
          {points.length > 0 && <><Path d={path + ` L${points.length > 1 ? 292 : 8},118 L8,118 Z`} fill="url(#spendingFill)" /><Path d={path} fill="none" stroke="#bf6556" strokeWidth={2.5} strokeLinejoin="round" /></>}
        </Svg>
      </View>
      <View style={styles.row}>{points.filter((_, i) => mode === 'six' || i === 0 || i === Math.floor((points.length - 1) / 2) || i === points.length - 1).map(point => <Text key={point.date} style={styles.axis}>{mode === 'six' ? monthTitle(point.date).split(' ')[0].slice(0, 3) : point.date.slice(8) + '/' + point.date.slice(5, 7)}</Text>)}</View>
      {flow.expense === 0 && <Text style={styles.caption}>Nenhuma despesa no período.</Text>}
    </>}
    <DateSheet mode="range" visible={picker} title="Período do gráfico" value={custom} onClose={() => setPicker(false)} onConfirm={(from, to) => { setCustom({ from, to }); setMode('custom'); setPicker(false) }} />
  </View>
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 18, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 17, fontWeight: '600' },
  caption: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  total: { color: colors.text, fontSize: 28, fontWeight: '700', textAlign: 'center' },
  modes: { flexDirection: 'row', backgroundColor: colors.bg, borderRadius: 24, padding: 4 },
  mode: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 20 },
  selected: { backgroundColor: colors.primary }, modeText: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  arrow: { padding: 10 }, axis: { color: colors.faint, fontSize: 11 }, error: { color: colors.expense, fontSize: 13 },
})
