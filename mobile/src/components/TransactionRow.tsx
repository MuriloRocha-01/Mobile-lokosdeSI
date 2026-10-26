import { transactionIcon } from '../utils/categoryIcons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { paymentLabel } from '../utils/payment'
import { brl } from '../utils/format'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { Transaction } from '../@types/api'
import { CategoryBadge } from './CategoryBadge'

/** Uma transaÃ§Ã£o na lista: Ã­cone colorido da categoria, descriÃ§Ã£o, categoria Â· dia, e o valor em verde/vermelho.
 * Toque abre os detalhes; segurar (toque longo) abre a opÃ§Ã£o de apagar â€” ver `FinanceScreen.tsx`. */
export function TransactionRow({ item, onPress, onLongPress }: { item: Transaction; onPress?: () => void; onLongPress?: () => void }) {
  const { colors, mode } = useTheme()
  const styles = createStyles(colors, mode === 'dark')
  const income = item.type === 'income'
  const icon = transactionIcon(item.description, item.category.icon)
  const recurring = item.recurrence !== 'none' || item.recurrence_parent_id != null
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} accessibilityRole="button" accessibilityLabel={`${item.description}, ${income ? 'receita' : 'despesa'} de ${brl(item.amount)}. Toque para editar; segure para apagar.`} style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}>
      <View style={[styles.icon, { backgroundColor: mode === 'dark' ? colors.card : `${item.category.color}26` }]}>
        <CategoryBadge icon={icon} color={mode === 'dark' ? colors.text : item.category.color} size={22} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.description || item.category.name}
          </Text>
          {recurring && <MaterialCommunityIcons name="repeat" size={14} color={colors.faint} />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {item.payment_method ? paymentLabel(item.payment_method) : income ? 'Receita' : 'Despesa'}{item.card?.name ? ' Â· ' + item.card.name : ''}
        </Text>
      </View>
      <View style={styles.trailing}>
      <Text style={[styles.amount, { color: income ? colors.income : colors.expense }]}>
        {income ? '+' : 'âˆ’'} {brl(item.amount)}
      </Text>
      <Text style={styles.time}>{item.time ?? 'Sem horÃ¡rio'}</Text>
      <Text style={[styles.time, { color: item.status === 'pending' ? colors.expense : colors.income }]}>{item.status === 'pending' ? 'Pendente' : income ? 'Recebida' : 'Paga'}</Text>
      </View>
    </Pressable>
  )
}

const createStyles = (colors: ThemeColors, dark: boolean) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: dark ? 12 : 14, paddingHorizontal: dark ? 0 : 14, marginBottom: dark ? 0 : 8, backgroundColor: dark ? colors.bg : colors.card, borderRadius: dark ? 0 : 20, borderWidth: dark ? 0 : 1, borderBottomWidth: dark ? StyleSheet.hairlineWidth : 1, borderColor: colors.border },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: dark ? '400' : '600', flexShrink: 1 },
  meta: { color: colors.faint, fontSize: 13, marginTop: 2 },
  trailing: { alignItems: 'flex-end', maxWidth: '45%', gap: 6 },
  time: { color: colors.faint, fontSize: 12 },
  amount: { fontSize: 14, fontWeight: '700', flexShrink: 0, fontVariant: ['tabular-nums'] },

})
