import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage, listAgenda, setAgendaStatus, setOccurrenceDone } from '../api'
import { addDays, dayHeading, todayIso } from '../format'
import { success, tap } from '../haptics'
import { colors, radius } from '../theme'
import type { AgendaItem } from '../types'
import { FAB_SIZE } from './FinanceScreen'

const DAYS_SHOWN = 14
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

interface Props {
  /** Muda depois de criar um item: a lista busca de novo. */
  refreshKey: number
  notice: string
  onNew: () => void
  /** Chamado depois de marcar/desmarcar algo (o app reagenda os lembretes). */
  onChanged: () => void
}

/** "Todo dia", "Seg, Qua e Sex", "Todo mês"... */
export function describeRepeat(item: AgendaItem): string {
  if (item.recurrence === 'daily') return 'Todo dia'
  if (item.recurrence === 'monthly') return 'Todo mês'
  if (item.recurrence === 'yearly') return 'Todo ano'
  if (item.recurrence !== 'weekly') return ''
  const days = [...item.recurrence_days].sort((a, b) => a - b)
  if (days.length === 5 && days.every((d) => d < 5)) return 'Dias úteis'
  if (days.length === 7) return 'Todo dia'
  const names = days.map((d) => WEEKDAYS[d])
  return names.length <= 1 ? `Toda ${(names[0] ?? 'semana').toLowerCase()}` : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/** Aba "Agenda": o que vem por aí nos próximos dias, com o círculo para marcar como feito e o botão + para criar. */
export function AgendaScreen({ refreshKey, notice, onNew, onChanged }: Props) {
  const insets = useSafeAreaInsets()
  const [items, setItems] = useState<AgendaItem[] | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const today = todayIso()
      setItems(await listAgenda(today, addDays(today, DAYS_SHOWN - 1)))
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  async function toggle(item: AgendaItem) {
    const done = item.status !== 'concluido'
    tap()
    try {
      const updated = item.recurrence !== 'none' ? await setOccurrenceDone(item.id, item.date, done) : await setAgendaStatus(item.id, done ? 'concluido' : 'pendente')
      setItems((current) => (current ?? []).map((row) => (row.id === item.id && row.date === item.date ? { ...row, status: updated.status } : row)))
      if (done) success()
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  const groups = useMemo(() => {
    const map = new Map<string, AgendaItem[]>()
    for (const item of items ?? []) map.set(item.date, [...(map.get(item.date) ?? []), item])
    return [...map.entries()]
  }, [items])

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: FAB_SIZE + 48 }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true)
              void load().finally(() => setRefreshing(false))
            }}
            tintColor={colors.muted}
            colors={[colors.muted]}
            progressBackgroundColor={colors.card}
          />
        }
      >
        <Text style={styles.title}>Agenda</Text>
        <Text style={styles.subtitle}>Próximos {DAYS_SHOWN} dias</Text>

        {error ? (
          <Pressable onPress={() => void load()} style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
            <Text style={styles.errorAction}>Tocar para tentar de novo</Text>
          </Pressable>
        ) : items === null ? (
          <ActivityIndicator color={colors.muted} style={styles.center} />
        ) : groups.length === 0 ? (
          <Text style={styles.empty}>Nada marcado para os próximos dias. Toque no + para criar um compromisso ou uma rotina com lembrete.</Text>
        ) : (
          groups.map(([day, rows]) => (
            <View key={day} style={styles.group}>
              <Text style={styles.dayTitle}>{dayHeading(day)}</Text>
              {rows.map((item) => {
                const done = item.status === 'concluido'
                const repeat = describeRepeat(item)
                return (
                  <View key={`${item.id}-${item.date}`} style={styles.row}>
                    <Pressable
                      onPress={() => void toggle(item)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: done }}
                      accessibilityLabel={done ? `Reabrir ${item.title}` : `Concluir ${item.title}`}
                      hitSlop={10}
                      style={[styles.check, done && styles.checkOn]}
                    >
                      {done && <MaterialCommunityIcons name="check" size={18} color={colors.onPrimary} />}
                    </Pressable>
                    <View style={styles.body}>
                      <Text style={[styles.itemTitle, done && styles.itemDone]} numberOfLines={2}>
                        {item.title}
                      </Text>
                      <View style={styles.meta}>
                        <Text style={styles.metaText}>{item.time ?? 'Dia todo'}</Text>
                        {repeat ? (
                          <View style={styles.badge}>
                            <MaterialCommunityIcons name="repeat" size={14} color={colors.faint} />
                            <Text style={styles.metaText}>{repeat}</Text>
                          </View>
                        ) : null}
                        {item.reminder_minutes !== null ? <MaterialCommunityIcons name="bell-outline" size={14} color={colors.faint} /> : null}
                      </View>
                    </View>
                  </View>
                )
              })}
            </View>
          ))
        )}
      </ScrollView>

      {notice ? (
        <View style={[styles.notice, { top: insets.top + 8 }]} accessibilityRole="alert">
          <MaterialCommunityIcons name="check-circle" size={20} color={colors.income} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}

      <Pressable
        onPress={() => {
          tap()
          onNew()
        }}
        accessibilityRole="button"
        accessibilityLabel="Novo item na agenda"
        style={({ pressed }) => [styles.fab, pressed && { transform: [{ scale: 0.94 }] }]}
      >
        <MaterialCommunityIcons name="plus" size={44} color={colors.onPrimary} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 16, gap: 8 },
  title: { color: colors.text, fontSize: 30, fontWeight: '700' },
  subtitle: { color: colors.faint, fontSize: 14, marginTop: -4, marginBottom: 8 },
  center: { marginTop: 32 },
  empty: { color: colors.faint, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 32, paddingHorizontal: 20 },
  errorBox: { marginTop: 8, padding: 14, borderRadius: radius.md, backgroundColor: colors.card },
  errorText: { color: colors.expense, fontSize: 14, lineHeight: 20 },
  errorAction: { color: colors.muted, fontSize: 13, marginTop: 6 },
  group: { marginTop: 12 },
  dayTitle: { color: colors.muted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  check: { width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: colors.faint, alignItems: 'center', justifyContent: 'center' },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  body: { flex: 1 },
  itemTitle: { color: colors.text, fontSize: 17, fontWeight: '600' },
  itemDone: { color: colors.faint, textDecorationLine: 'line-through' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 3 },
  metaText: { color: colors.faint, fontSize: 13, fontVariant: ['tabular-nums'] },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  notice: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: colors.cardHigh, borderWidth: 1, borderColor: colors.border },
  noticeText: { color: colors.text, fontSize: 15, flex: 1 },
  fab: { position: 'absolute', right: 20, bottom: 20, width: FAB_SIZE, height: FAB_SIZE, borderRadius: FAB_SIZE / 2, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
})
