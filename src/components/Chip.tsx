import { Pressable, StyleSheet, Text } from 'react-native'
import { tap } from '../haptics'
import { colors } from '../theme'

interface Props {
  label: string
  selected: boolean
  onPress: () => void
  /** Cor do destaque quando marcado (padrão: branco). */
  color?: string
}

/** Uma opção em forma de "pílula" (dia, hora, repetição, lembrete...). Grande o bastante para tocar com o polegar. */
export function Chip({ label, selected, onPress, color = colors.text }: Props) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => {
        tap()
        onPress()
      }}
      style={[styles.chip, selected && { backgroundColor: `${color}22`, borderColor: color }]}
    >
      <Text style={[styles.text, selected && { color: colors.text }]}>{label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  chip: { height: 42, paddingHorizontal: 14, borderRadius: 21, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 15, fontWeight: '600' },
})
