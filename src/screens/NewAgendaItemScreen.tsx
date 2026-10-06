import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { maskDate, maskTime, parseDate, parseTime, weekdayOf } from '../agendaForm'
import { createAgendaItem, errorMessage } from '../api'
import { Chip } from '../components/Chip'
import { addDays, todayIso } from '../format'
import { success, tap, warning } from '../haptics'
import { colors, radius } from '../theme'
import type { Recurrence } from '../types'

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const QUICK_TIMES = ['07:00', '08:00', '12:00', '18:00', '21:00']

type Repeat = 'none' | 'daily' | 'workdays' | 'weekly' | 'monthly'
const REPEATS: { id: Repeat; label: string }[] = [
  { id: 'none', label: 'Não repete' },
  { id: 'daily', label: 'Todo dia' },
  { id: 'workdays', label: 'Dias úteis' },
  { id: 'weekly', label: 'Toda semana' },
  { id: 'monthly', label: 'Todo mês' },
]

const REMINDERS: { minutes: number | null; label: string }[] = [
  { minutes: null, label: 'Sem aviso' },
  { minutes: 0, label: 'Na hora' },
  { minutes: 10, label: '10 min antes' },
  { minutes: 30, label: '30 min antes' },
  { minutes: 60, label: '1 h antes' },
  { minutes: 1440, label: '1 dia antes' },
]

interface Props {
  onClose: () => void
  onSaved: (message: string) => void
}

/**
 * "Novo item" da agenda: título, dia, hora, repetição e aviso, tudo em toques (sem formulário longo).
 * Uma rotina ("todo dia às 7h: tomar vitamina") é um item com repetição e aviso.
 */
export function NewAgendaItemScreen({ onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets()
  const [title, setTitle] = useState('')
  const [day, setDay] = useState<'today' | 'tomorrow' | 'custom'>('today')
  const [customDate, setCustomDate] = useState('')
  const [time, setTime] = useState<string | null>(null) // "07:00"; null = o dia todo
  const [customTime, setCustomTime] = useState('')
  const [showCustomTime, setShowCustomTime] = useState(false)
  const [repeat, setRepeat] = useState<Repeat>('none')
  const [weekdays, setWeekdays] = useState<number[]>([])
  const [reminder, setReminder] = useState<number | null>(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const startIso = day === 'today' ? todayIso() : day === 'tomorrow' ? addDays(todayIso(), 1) : parseDate(customDate)

  function pickTime(value: string | null) {
    setTime(value)
    setShowCustomTime(false)
    setCustomTime('')
  }

  function onCustomTime(text: string) {
    const masked = maskTime(text)
    setCustomTime(masked)
    setTime(parseTime(masked)) // só vale quando a hora está completa e certa
  }

  function toggleWeekday(index: number) {
    setWeekdays((current) => (current.includes(index) ? current.filter((d) => d !== index) : [...current, index]))
  }

  async function save() {
    if (saving) return
    setError('')
    if (!title.trim()) return fail('Dê um nome ao item.')
    if (!startIso) return fail('Digite o dia completo, como 25/12/2026.')
    if (showCustomTime && customTime && !time) return fail('Digite a hora completa, como 07:30.')
    setSaving(true)
    const recurrence: Recurrence = repeat === 'workdays' ? 'weekly' : repeat
    const days = repeat === 'workdays' ? [0, 1, 2, 3, 4] : repeat === 'weekly' ? (weekdays.length > 0 ? weekdays : [weekdayOf(startIso)]) : []
    try {
      await createAgendaItem({
        title: title.trim(),
        type: repeat !== 'none' || !time ? 'tarefa' : 'compromisso',
        date: startIso,
        time,
        recurrence,
        recurrence_days: days,
        reminder_minutes: reminder,
      })
      success()
      onSaved(repeat !== 'none' ? `Rotina “${title.trim()}” criada` : `“${title.trim()}” adicionado à agenda`)
    } catch (err) {
      fail(errorMessage(err))
      setSaving(false)
    }
  }

  function fail(message: string) {
    warning()
    setError(message)
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={12} style={styles.close}>
          <MaterialCommunityIcons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.heading}>Novo na agenda</Text>
        <View style={styles.close} />
      </View>

      <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="O que você precisa lembrar?"
          placeholderTextColor={colors.faint}
          maxLength={200}
          autoFocus
          returnKeyType="done"
          style={styles.title}
        />

        <Text style={styles.label}>Quando</Text>
        <View style={styles.chips}>
          <Chip label="Hoje" selected={day === 'today'} onPress={() => setDay('today')} />
          <Chip label="Amanhã" selected={day === 'tomorrow'} onPress={() => setDay('tomorrow')} />
          <Chip label="Outro dia" selected={day === 'custom'} onPress={() => setDay('custom')} />
        </View>
        {day === 'custom' && (
          <TextInput
            value={customDate}
            onChangeText={(text) => setCustomDate(maskDate(text))}
            placeholder="DD/MM/AAAA"
            placeholderTextColor={colors.faint}
            keyboardType="number-pad"
            maxLength={10}
            autoFocus
            style={styles.input}
          />
        )}

        <Text style={styles.label}>Que horas</Text>
        <View style={styles.chips}>
          <Chip label="Dia todo" selected={time === null && !showCustomTime} onPress={() => pickTime(null)} />
          {QUICK_TIMES.map((value) => (
            <Chip key={value} label={value} selected={time === value && !showCustomTime} onPress={() => pickTime(value)} />
          ))}
          <Chip label="Outra hora" selected={showCustomTime} onPress={() => setShowCustomTime(true)} />
        </View>
        {showCustomTime && (
          <TextInput value={customTime} onChangeText={onCustomTime} placeholder="HH:MM (ex.: 07:30)" placeholderTextColor={colors.faint} keyboardType="number-pad" maxLength={5} autoFocus style={styles.input} />
        )}

        <Text style={styles.label}>Repetir</Text>
        <View style={styles.chips}>
          {REPEATS.map((option) => (
            <Chip
              key={option.id}
              label={option.label}
              selected={repeat === option.id}
              onPress={() => {
                setRepeat(option.id)
                // Toda semana: já começa com o dia da semana do início marcado (dá para juntar outros).
                if (option.id === 'weekly') setWeekdays((current) => (current.length > 0 ? current : [weekdayOf(startIso ?? todayIso())]))
              }}
            />
          ))}
        </View>
        {repeat === 'weekly' && (
          <View style={styles.weekdays}>
            {WEEKDAYS.map((label, index) => {
              const on = weekdays.includes(index)
              return (
                <Pressable
                  key={label}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  onPress={() => {
                    tap()
                    toggleWeekday(index)
                  }}
                  style={[styles.weekday, on && styles.weekdayOn]}
                >
                  <Text style={[styles.weekdayText, on && styles.weekdayTextOn]}>{label}</Text>
                </Pressable>
              )
            })}
          </View>
        )}

        <Text style={styles.label}>Avisar no celular</Text>
        <View style={styles.chips}>
          {REMINDERS.map((option) => (
            <Chip key={option.label} label={option.label} selected={reminder === option.minutes} onPress={() => setReminder(option.minutes)} />
          ))}
        </View>
        {reminder !== null && time === null && <Text style={styles.hint}>Sem hora definida, o aviso chega às 8h {reminder >= 1440 ? 'do dia anterior' : 'do dia'}.</Text>}
      </ScrollView>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <Pressable onPress={() => void save()} disabled={saving} accessibilityRole="button" style={({ pressed }) => [styles.save, (saving || pressed) && { opacity: 0.8 }]}>
        {saving ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.saveText}>{repeat !== 'none' ? 'Criar rotina' : 'Salvar'}</Text>}
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 16, gap: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
  form: { gap: 10, paddingBottom: 16 },
  title: { height: 60, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 20, fontWeight: '600', paddingHorizontal: 16 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  input: { height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.faint, backgroundColor: colors.card, color: colors.text, fontSize: 18, paddingHorizontal: 14, fontVariant: ['tabular-nums'] },
  weekdays: { flexDirection: 'row', gap: 6, justifyContent: 'space-between' },
  weekday: { flex: 1, height: 46, borderRadius: 23, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  weekdayOn: { backgroundColor: `${colors.text}22`, borderColor: colors.text },
  weekdayText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  weekdayTextOn: { color: colors.text },
  hint: { color: colors.faint, fontSize: 13, lineHeight: 19 },
  error: { color: colors.expense, fontSize: 14, textAlign: 'center' },
  save: { height: 60, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },
})
