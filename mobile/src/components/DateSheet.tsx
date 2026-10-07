import { useState } from 'react'
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { MAX_RANGE_DAYS, dateBr, dateShort, daysBetween } from '../utils/calendarUtils'
import type { RangeSel } from '../utils/calendarUtils'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import { CalendarPicker } from './CalendarPicker'

type SingleSheet = { mode: 'single'; value: string | null; onPick: (iso: string) => void }
type RangeSheet = { mode: 'range'; value: { from: string; to: string } | null; onConfirm: (from: string, to: string) => void; maxDays?: number }
type Props = (SingleSheet | RangeSheet) & { visible: boolean; title: string; onClose: () => void; minDate?: string; maxDate?: string }

/** O calendário numa folha que sobe de baixo. Dia: tocar já escolhe e fecha. Período: Cancelar / Confirmar. */
export function DateSheet(props: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const insets = useSafeAreaInsets()
  const { visible, title, onClose } = props
  return (
    // `onRequestClose` (botão voltar do Android) fecha só a folha, sem passar pelo "voltar" do app.
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Fechar calendário" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <Text style={styles.title}>{title}</Text>
          {props.mode === 'single' ? (
            <CalendarPicker
              mode="single"
              value={props.value}
              minDate={props.minDate}
              maxDate={props.maxDate}
              onChange={(iso) => {
                props.onPick(iso)
                onClose()
              }}
            />
          ) : (
            <RangeBody value={props.value} maxDays={props.maxDays} minDate={props.minDate} maxDate={props.maxDate} onCancel={onClose} onConfirm={props.onConfirm} />
          )}
        </View>
      </View>
    </Modal>
  )
}

/** Fica dentro do `Modal` (que só monta o conteúdo aberto), então a seleção recomeça do valor atual a cada abertura. */
function RangeBody({
  value,
  maxDays = MAX_RANGE_DAYS,
  minDate,
  maxDate,
  onCancel,
  onConfirm,
}: {
  value: { from: string; to: string } | null
  maxDays?: number
  minDate?: string
  maxDate?: string
  onCancel: () => void
  onConfirm: (from: string, to: string) => void
}) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const [sel, setSel] = useState<RangeSel>({ start: value?.from ?? null, end: value?.to ?? null })
  const days = sel.start && sel.end ? daysBetween(sel.start, sel.end) + 1 : sel.start ? 1 : 0
  const summary = !sel.start
    ? 'Toque no primeiro dia do período'
    : !sel.end
      ? `${dateBr(sel.start)} · toque no último dia (ou confirme só este)`
      : `${dateShort(sel.start)} – ${dateShort(sel.end)} · ${days === 1 ? '1 dia' : `${days} dias`}`

  return (
    <>
      <CalendarPicker mode="range" value={sel} onChange={setSel} maxDays={maxDays} minDate={minDate} maxDate={maxDate} />
      <Text style={styles.summary}>{summary}</Text>
      <View style={styles.actions}>
        <Pressable onPress={onCancel} accessibilityRole="button" style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
        <Pressable
          onPress={() => sel.start && onConfirm(sel.start, sel.end ?? sel.start)}
          disabled={!sel.start}
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, styles.confirm, !sel.start && styles.off, pressed && styles.pressed]}
        >
          <Text style={styles.confirmText}>Confirmar</Text>
        </Pressable>
      </View>
    </>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 12, paddingTop: 16, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center', marginBottom: 8 },
  summary: { color: colors.text, fontSize: 14, textAlign: 'center', marginTop: 10, marginBottom: 4 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 8 },
  button: { flex: 1, height: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cancel: { borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  confirm: { backgroundColor: colors.primary },
  confirmText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.8 },
})
