import { MaterialCommunityIcons } from '@expo/vector-icons'
import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { colors, radius } from '../theme'

/** A faixa verde de confirmação ("Despesa de R$ 12,50 salva") por cima da tela, por alguns segundos. */
export function NoticeBanner({ notice }: { notice: string }) {
  const insets = useSafeAreaInsets()
  if (!notice) return null
  return (
    <View style={[styles.notice, { top: insets.top + 8 }]} accessibilityRole="alert">
      <MaterialCommunityIcons name="check-circle" size={20} color={colors.income} />
      <Text style={styles.text}>{notice}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  notice: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, backgroundColor: colors.cardHigh, borderWidth: 1, borderColor: colors.border },
  text: { color: colors.text, fontSize: 15, flex: 1 },
})
