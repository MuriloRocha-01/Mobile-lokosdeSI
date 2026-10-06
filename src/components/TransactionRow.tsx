import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { brl, relativeDay } from '../format'
import { colors } from '../theme'
import type { Transaction } from '../types'
import { CategoryBadge } from './CategoryBadge'

/** Uma transação na lista: ícone colorido da categoria, descrição, categoria · dia, e o valor em verde/vermelho.
 * Toque abre para editar; segurar (toque longo) abre a opção de apagar — ver `FinanceScreen.tsx`. */
export function TransactionRow({ item, onPress, onLongPress }: { item: Transaction; onPress?: () => void; onLongPress?: () => void }) {
  const income = item.type === 'income'
  const recurring = item.recurrence !== 'none' || item.recurrence_parent_id != null
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={400} style={styles.row}>
      <View style={[styles.icon, { backgroundColor: `${item.category.color}26` }]}>
        <CategoryBadge icon={item.category.icon} color={item.category.color} size={22} />
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1 },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flexShrink: 1 },
  meta: { color: colors.faint, fontSize: 13, marginTop: 2 },
  amount: { fontSize: 16, fontWeight: '700', fontVariant: ['tabular-nums'] },
})
