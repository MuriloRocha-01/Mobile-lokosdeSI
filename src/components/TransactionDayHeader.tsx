import { StyleSheet, Text, View } from 'react-native'
import { dateBr } from '../calendarUtils'
import { relativeDay } from '../format'
import { colors } from '../theme'

export function TransactionDayHeader({ date }: { date: string }) {
  return <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{relativeDay(date)}</Text><Text style={styles.date}>{dateBr(date)}</Text></View>
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingTop: 28, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  title: { color: colors.text, fontSize: 16, fontWeight: '600' },
  date: { color: colors.faint, fontSize: 12 },
})
