import { updateTransaction, errorMessage } from '../api'
import { useState } from 'react'
import { confirmDeleteTransaction } from '../transactionActions'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dateBr } from '../calendarUtils'
import { CategoryBadge } from '../components/CategoryBadge'
import { cardLabel, paymentLabel } from '../payment'
import { brl } from '../format'
import { colors } from '../theme'
import type { Transaction } from '../types'

export function TransactionDetailsScreen({ transaction, onClose, onEdit, onDeleted, onChanged }: { transaction: Transaction; onClose: () => void; onEdit: () => void; onDeleted: () => void; onChanged: (item: Transaction) => void }) {
  const [saving, setSaving] = useState(false)
  async function toggleStatus() {
    if (saving) return
    setSaving(true); setError('')
    try { onChanged(await updateTransaction(transaction.id, { status: transaction.status === 'pending' ? 'settled' : 'pending' })) }
    catch (err) { setError(errorMessage(err)) }
    finally { setSaving(false) }
  }
  const [error, setError] = useState('')
  const insets = useSafeAreaInsets()
  const { category } = transaction
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
      <View style={styles.topBar}>
        <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" style={styles.button}>
          <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable disabled={saving} accessibilityRole="button" accessibilityLabel={transaction.type === 'expense' ? 'Excluir despesa' : 'Excluir receita'} onPress={() => confirmDeleteTransaction(transaction, onDeleted, setError)} style={styles.button}>
          <MaterialCommunityIcons name="trash-can-outline" size={22} color={colors.expense} />
        </Pressable>
        <Pressable onPress={onEdit} accessibilityRole="button" accessibilityLabel="Editar transação" style={styles.button}>
          <MaterialCommunityIcons name="pencil-outline" size={20} color={colors.text} />
        </Pressable>
        </View>
      </View>
      <View style={styles.hero}>
        <View style={[styles.icon, { backgroundColor: category.color + '22' }]}><CategoryBadge icon={category.icon} color={category.color} size={22} /></View>
        <Text style={styles.category}>{category.name}</Text>
        <Text style={styles.label}>{transaction.type === 'expense' ? 'Valor da despesa' : 'Valor da receita'}</Text>
        <Text style={styles.amount} adjustsFontSizeToFit numberOfLines={1}>{brl(transaction.amount)}</Text>
      </View>
      <View style={styles.row}><Text style={styles.label}>Situação</Text><Text style={styles.value}>{transaction.status === 'pending' ? 'Pendente' : transaction.type === 'income' ? 'Recebida' : 'Paga'}{transaction.settled_at && transaction.status !== 'pending' ? ' · ' + dateBr(transaction.settled_at) : ''}</Text>
        <Pressable disabled={saving} accessibilityRole="button" onPress={() => void toggleStatus()} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: colors.income, fontSize: 16 }}>{saving ? 'Salvando…' : transaction.status === 'pending' ? (transaction.type === 'income' ? 'Confirmar recebimento hoje' : 'Confirmar pagamento hoje') : 'Voltar para pendente'}</Text></Pressable>
      </View>
      <View style={styles.row}><Text style={styles.label}>Motivo</Text><Text style={styles.value}>{category.name}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Forma de pagamento</Text><Text style={styles.value}>{paymentLabel(transaction.payment_method)}</Text>{transaction.card && <Text style={styles.value}>{cardLabel(transaction.card)}</Text>}</View>
      <View style={styles.row}><Text style={styles.label}>Data</Text><Text style={styles.value}>{dateBr(transaction.date)} · {transaction.time ?? 'Horário não informado'}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Descrição</Text><Text style={styles.value}>{transaction.description || 'Sem descrição'}</Text></View>
      <View style={styles.row}><Text style={styles.label}>Repetição</Text><Text style={styles.value}>{transaction.installment_number != null ? `Parcela ${transaction.installment_number}/${transaction.installment_count}` : transaction.recurrence_parent_id != null ? 'Ocorrência de gasto fixo' : transaction.recurrence === 'monthly' ? 'Todo mês' : transaction.recurrence === 'yearly' ? 'Todo ano' : 'Não repete'}{transaction.recurrence_until ? ' · até ' + dateBr(transaction.recurrence_until) : ''}</Text></View>
      {error ? <Text accessibilityRole="alert" style={{ color: colors.expense }}>{error}</Text> : null}
      <Pressable accessibilityRole="button" accessibilityLabel={transaction.type === 'expense' ? 'Excluir despesa' : 'Excluir receita'} onPress={() => confirmDeleteTransaction(transaction, onDeleted, setError)} style={[styles.row, { flexDirection: 'row', alignItems: 'center', gap: 10 }]}>
        <MaterialCommunityIcons name="trash-can-outline" size={20} color={colors.expense} /><Text style={{ color: colors.expense, fontSize: 16 }}>{transaction.type === 'expense' ? 'Excluir despesa' : 'Excluir receita'}</Text>
      </Pressable>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: { flexDirection: 'row', justifyContent: 'space-between' },
  button: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  hero: { paddingTop: 32, paddingBottom: 36, gap: 10 },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  category: { color: colors.text, fontSize: 20, fontWeight: '600', marginBottom: 12 },
  label: { color: colors.muted, fontSize: 14 },
  amount: { color: colors.text, fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  row: { paddingVertical: 18, borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, gap: 8 },
  value: { color: colors.text, fontSize: 16, lineHeight: 24 },
})
