import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { brl, relativeDay } from '../utils/format'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { Transaction } from '../@types/api'
import { CategoryBadge } from './CategoryBadge'

/** Uma transação na lista: ícone colorido da categoria, descrição, categoria · dia, e o valor em verde/vermelho.
 * Toque abre para editar; segurar (toque longo) abre a opção de apagar — ver `FinanceScreen.tsx`. */
export function TransactionRow({ item, onPress, onLongPress }: { item: Transaction; onPress?: () => void; onLongPress?: () => void }) {
  const { colors, mode } = useTheme()
  const styles = createStyles(colors, mode === 'dark')
  const income = item.type === 'income'
  const recurring = item.recurrence !== 'none' || item.recurrence_parent_id != null
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} accessibilityRole="button" accessibilityLabel={`${item.description}, ${income ? 'receita' : 'despesa'} de ${brl(item.amount)}. Toque para editar; segure para apagar.`} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.icon, { backgroundColor: mode === 'dark' ? colors.card : `${item.category.color}26` }]}>
        <CategoryBadge icon={item.category.icon} color={mode === 'dark' ? colors.text : item.category.color} size={22} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.description}
          </Text>
          {recurring && <MaterialCommunityIcons name="repeat" size={14} color={colors.faint} />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {item.category.name} · {relativeDay(item.date)}
        </Text>
      </View>
      <Text style={[styles.amount, { color: income ? colors.income : colors.expense }]}>
        {income ? '+' : '−'} {brl(item.amount)}
      </Text>
    </Pressable>
  )
}

const createStyles = (colors: ThemeColors, dark: boolean) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: dark ? 12 : 14, paddingHorizontal: dark ? 0 : 14, marginBottom: dark ? 0 : 8, backgroundColor: dark ? colors.bg : colors.card, borderRadius: dark ? 0 : 20, borderWidth: dark ? 0 : 1, borderBottomWidth: dark ? StyleSheet.hairlineWidth : 1, borderColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: dark ? '400' : '600', flexShrink: 1 },
  meta: { color: colors.faint, fontSize: 13, marginTop: 2 },
  amount: { fontSize: 14, fontWeight: '700', flexShrink: 0, fontVariant: ['tabular-nums'] },
})
