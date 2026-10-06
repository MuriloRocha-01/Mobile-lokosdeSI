import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { MAX_DATE, MAX_RANGE_DAYS, MIN_DATE, MONTH_NAMES_PT, WEEKDAY_INITIALS, dateBr, isoOf, monthGrid, nextRange, shiftMonth } from '../calendarUtils'
import type { RangeSel } from '../calendarUtils'
import { todayIso } from '../format'
import { tap } from '../haptics'
import { colors, radius } from '../theme'

type SingleProps = { mode: 'single'; value: string | null; onChange: (iso: string) => void }
type RangeProps = { mode: 'range'; value: RangeSel; onChange: (selection: RangeSel) => void; maxDays?: number }
type Props = (SingleProps | RangeProps) & { minDate?: string; maxDate?: string }

/**
 * Calendário em JS puro (sem biblioteca nativa de data — a compatibilidade dela com esta versão do Expo não
 * dá pra testar antes de gerar o app). `single` escolhe um dia; `range` escolhe um período (1º toque = início,
 * 2º = fim; tocar antes do início troca os dois; um 3º toque recomeça).
 */
export function CalendarPicker(props: Props) {
  const minDate = props.minDate ?? MIN_DATE
  const maxDate = props.maxDate ?? MAX_DATE
  const anchor = props.mode === 'single' ? props.value : props.value.start
  const [year0, month1] = (anchor ?? todayIso()).split('-').map(Number)
  const [view, setView] = useState({ year: year0, month0: month1 - 1 })
  const [error, setError] = useState('')
  const today = todayIso()

  const canGo = (delta: number) => {
    const target = shiftMonth(view.year, view.month0, delta)
    const last = isoOf(target.year, target.month0, new Date(target.year, target.month0 + 1, 0).getDate())
    return last >= minDate && isoOf(target.year, target.month0, 1) <= maxDate
  }
  const go = (delta: number) => {
    if (!canGo(delta)) return
    tap()
    setView((current) => shiftMonth(current.year, current.month0, delta))
  }

  function pick(iso: string) {
    tap()
    if (props.mode === 'single') {
      props.onChange(iso)
      return
    }
    const result = nextRange(props.value, iso, props.maxDays ?? MAX_RANGE_DAYS)
    setError(result.error ?? '')
    if (!result.error) props.onChange(result.sel)
  }

  const start = props.mode === 'range' ? props.value.start : props.value
  const end = props.mode === 'range' ? props.value.end : props.value

  const nav = (delta: number, icon: 'chevron-left' | 'chevron-right' | 'chevron-double-left' | 'chevron-double-right', label: string) => (
    <Pressable onPress={() => go(delta)} disabled={!canGo(delta)} accessibilityRole="button" accessibilityLabel={label} hitSlop={6} style={[styles.nav, !canGo(delta) && styles.navOff]}>
      <MaterialCommunityIcons name={icon} size={24} color={colors.text} />
    </Pressable>
  )

  return (
    <View>
      <View style={styles.header}>
        {nav(-12, 'chevron-double-left', 'Um ano antes')}
        {nav(-1, 'chevron-left', 'Mês anterior')}
        <Text style={styles.title} accessibilityRole="header">
          {MONTH_NAMES_PT[view.month0]} {view.year}
        </Text>
        {nav(1, 'chevron-right', 'Próximo mês')}
        {nav(12, 'chevron-double-right', 'Um ano depois')}
      </View>

      <View style={styles.row}>
        {WEEKDAY_INITIALS.map((letter, index) => (
          <Text key={index} style={styles.weekday}>
            {letter}
          </Text>
        ))}
      </View>

      {monthGrid(view.year, view.month0).map((week, rowIndex) => (
        <View key={rowIndex} style={styles.row}>
          {week.map((iso, cellIndex) => {
            if (!iso) return <View key={cellIndex} style={styles.cell} />
            const disabled = iso < minDate || iso > maxDate
            const isEdge = iso === start || iso === end
            const inRange = props.mode === 'range' && start !== null && end !== null && iso > start && iso < end
            const isToday = iso === today
            return (
              <View key={cellIndex} style={[styles.cell, inRange && styles.cellInRange]}>
                <Pressable
                  onPress={() => pick(iso)}
                  disabled={disabled}
                  accessibilityRole="button"
                  accessibilityLabel={dateBr(iso)}
                  accessibilityState={{ selected: isEdge, disabled }}
                  style={[styles.day, isToday && !isEdge && styles.dayToday, isEdge && styles.dayEdge]}
                >
                  <Text style={[styles.dayText, disabled && styles.dayTextOff, isEdge && styles.dayTextEdge]}>{Number(iso.slice(8))}</Text>
                </Pressable>
              </View>
            )
          })}
        </View>
      ))}

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  nav: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  navOff: { opacity: 0.25 },
  title: { flex: 1, textAlign: 'center', color: colors.text, fontSize: 17, fontWeight: '700' },
  row: { flexDirection: 'row' },
  weekday: { width: '14.2857%', textAlign: 'center', color: colors.faint, fontSize: 12, fontWeight: '700', paddingVertical: 6 },
  cell: { width: '14.2857%', height: 44, alignItems: 'center', justifyContent: 'center' },
  cellInRange: { backgroundColor: 'rgba(255,255,255,0.12)' },
  day: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: colors.faint },
  dayEdge: { backgroundColor: colors.primary },
  dayText: { color: colors.text, fontSize: 15, fontVariant: ['tabular-nums'] },
  dayTextOff: { color: colors.faint, opacity: 0.35 },
  dayTextEdge: { color: colors.onPrimary, fontWeight: '700' },
  error: { color: colors.expense, fontSize: 13, textAlign: 'center', marginTop: 8, borderRadius: radius.md },
})
