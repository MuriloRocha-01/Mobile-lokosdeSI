import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { IconName } from '../utils/categoryIcons'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'

interface Props {
  icon: IconName
  title: string
  description: string
  action?: string
  onAction?: () => void
}

export function EmptyState({ icon, title, description, action, onAction }: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return (
    <View style={styles.card}>
      <View style={styles.icon}><MaterialCommunityIcons name={icon} size={28} color={colors.primary} /></View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {action && onAction ? <Pressable onPress={onAction} accessibilityRole="button" style={({ pressed }) => [styles.action, pressed && { opacity: 0.75 }]}><Text style={styles.actionText}>{action}</Text></Pressable> : null}
    </View>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border, alignItems: 'center', padding: 24, marginTop: 12, gap: 12 },
  icon: { width: 60, height: 60, borderRadius: 22, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  description: { color: colors.muted, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  action: { minHeight: 44, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16, backgroundColor: colors.primarySoft, marginTop: 4 },
  actionText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
})
