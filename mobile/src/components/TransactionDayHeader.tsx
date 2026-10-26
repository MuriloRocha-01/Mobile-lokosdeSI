import { StyleSheet, Text, View } from 'react-native'
import { dateBr } from '../utils/calendarUtils'
import { relativeDay } from '../utils/format'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'

export function TransactionDayHeader({ date }: { date: string }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  return <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{relativeDay(date)}</Text><Text style={styles.date}>{dateBr(date)}</Text></View>
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingTop: 28, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  date: { color: colors.faint, fontSize: 12 },
})
