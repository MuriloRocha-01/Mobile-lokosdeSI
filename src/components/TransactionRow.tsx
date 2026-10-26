import { transactionIcon } from '../categoryIcons'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { paymentLabel } from '../payment'
import { brl } from '../format'
import { colors } from '../theme'
import type { Transaction } from '../types'
import { CategoryBadge } from './CategoryBadge'

/** Uma transação na lista: ícone colorido da categoria, descrição, categoria · dia, e o valor em verde/vermelho.
 * Toque abre os detalhes; segurar (toque longo) abre a opção de apagar — ver `FinanceScreen.tsx`. */
export function TransactionRow({ item, onPress, onLongPress }: { item: Transaction; onPress?: () => void; onLongPress?: () => void }) {
  const income = item.type === 'income'
  const icon = transactionIcon(item.description, item.category.icon)
  const recurring = item.recurrence !== 'none' || item.recurrence_parent_id != null
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} accessibilityRole="button" style={styles.row}>
      <View style={[styles.icon, { backgroundColor: `${item.category.color}26` }]}>
        <CategoryBadge icon={icon} color={item.category.color} size={18} />
      </View>
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>
            {item.description || item.category.name}
          </Text>
          {recurring && <MaterialCommunityIcons name="repeat" size={14} color={colors.faint} />}
        </View>
        <Text style={styles.meta} numberOfLines={1}>
          {item.payment_method ? paymentLabel(item.payment_method) : income ? 'Receita' : 'Despesa'}{item.card?.name ? ' · ' + item.card.name : ''}
        </Text>
      </View>
      <View style={styles.trailing}>
      <Text style={[styles.amount, { color: income ? colors.income : colors.expense }]}>
        {income ? '+' : '−'} {brl(item.amount)}
      </Text>
      <Text style={styles.time}>{item.time ?? 'Sem horário'}</Text>
      <Text style={[styles.time, { color: item.status === 'pending' ? colors.expense : colors.income }]}>{item.status === 'pending' ? 'Pendente' : income ? 'Recebida' : 'Paga'}</Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minWidth: 0 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  meta: { color: colors.faint, fontSize: 13, marginTop: 2 },
  trailing: { alignItems: 'flex-end', maxWidth: '45%', gap: 6 },
  time: { color: colors.faint, fontSize: 12 },
  amount: { fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
})
