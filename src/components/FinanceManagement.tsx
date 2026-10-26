import { useCallback, useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage, getFinanceOverview, getTransaction, listTransactions, removeGoal, saveGoal, updateTransaction } from '../api'
import { parseAmountText, dateBr } from '../calendarUtils'
import { brl, todayIso } from '../format'
import { colors } from '../theme'
import { confirmDestructive } from '../confirm'
import type { FinanceOverview, SavingsGoal, Transaction } from '../types'
import { Chip } from './Chip'
import { TransactionRow } from './TransactionRow'
import { refreshWidgets } from '../widgets'

export function FinanceManagement({ section, onOpen, onNew, onChanged }: { section: string; onOpen: (item: Transaction) => void; onNew: () => void; onChanged: () => void }) {
  const insets = useSafeAreaInsets()
  const [overview, setOverview] = useState<FinanceOverview | null>(null)
  const [status, setStatus] = useState<'pending' | 'settled'>('pending')
  const [items, setItems] = useState<Transaction[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const revision = useRef(0)
  const [editor, setEditor] = useState<{ goal?: SavingsGoal } | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [reserved, setReserved] = useState('')
  const [editError, setEditError] = useState('')
  const load = useCallback(async (offset = 0) => {
    const id = ++revision.current
    setLoading(true); setError('')
    try {
      const [next, page] = await Promise.all([getFinanceOverview(todayIso()), section === 'Contas' ? listTransactions({ status, offset, limit: 40 }) : Promise.resolve(null)])
      if (id !== revision.current) return
      setOverview(next)
      if (page) { setItems(old => offset ? [...old, ...page.items] : page.items); setTotal(page.total) }
    } catch (err) { if (id === revision.current) setError(errorMessage(err)) }
    finally { if (id === revision.current) setLoading(false) }
  }, [section, status])
  useEffect(() => { setItems([]); void load(); return () => { revision.current++ } }, [load])
  function edit(goal?: SavingsGoal) { setEditor({ goal }); setName(goal?.name ?? ''); setTarget(goal?.target.toFixed(2).replace('.', ',') ?? ''); setReserved(goal?.reserved.toFixed(2).replace('.', ',') ?? '0,00'); setEditError('') }
  async function persist() {
    if (busy) return
    const amount = parseAmountText(target), reserve = parseAmountText(reserved)
    if (!name.trim() || !amount || amount <= 0 || reserve === null || reserve < 0 || reserve > amount) { setEditError('Informe nome, meta maior que zero e reserva entre zero e o valor da meta.'); return }
    setBusy(true); setEditError('')
    try { await saveGoal({ name: name.trim(), target: amount, reserved: reserve }, editor?.goal?.id); setEditor(null); await load(); onChanged() }
    catch (err) { setEditError(errorMessage(err)) }
    finally { setBusy(false) }
  }
  async function openTransaction(id: number) {
    if (busy) return
    setBusy(true); setError('')
    try { onOpen(await getTransaction(id)) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  async function stopSubscription(id: number) {
    setBusy(true); setError('')
    try { await updateTransaction(id, { recurrence: 'none', recurrence_until: null }); await load(); onChanged(); void refreshWidgets().catch(() => {}) }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  async function deleteGoal(id: number) {
    setBusy(true); setError('')
    try { await removeGoal(id); await load(); onChanged() } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return <View style={{ gap: 16 }}>
    {error ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text accessibilityRole="alert" style={s.error}>{error}</Text><Text style={s.text}>Tentar novamente</Text></Pressable> : null}
    {loading && <ActivityIndicator color={colors.text} />}
    {section === 'Contas' && <>
      {overview && <View style={s.card}><Text style={s.title}>A pagar: {brl(overview.pending.expense)}</Text><Text style={s.title}>A receber: {brl(overview.pending.income)}</Text><Text style={s.hint}>Todos os lançamentos pendentes cadastrados, incluindo vencidos e parcelas futuras. Toque em um para confirmar a baixa.</Text></View>}
      <View style={s.row}><Chip label="Pendentes" selected={status === 'pending'} onPress={() => setStatus('pending')} /><Chip label="Pagas / recebidas" selected={status === 'settled'} onPress={() => setStatus('settled')} /></View>
      {items.map(item => <View key={item.id} style={s.card}><Text style={s.hint}>{dateBr(item.date)}{item.status === 'pending' && item.date < todayIso() ? ' · Data prevista vencida' : ''}</Text><TransactionRow item={item} onPress={() => onOpen(item)} /></View>)}
      {!loading && !items.length && !error && <Text style={s.hint}>Nenhum lançamento nesta situação.</Text>}
      {items.length < total && <Pressable accessibilityRole="button" disabled={loading} style={s.button} onPress={() => void load(items.length)}><Text style={s.text}>Carregar mais</Text></Pressable>}
    </>}
    {section === 'Assinaturas' && <>
      {overview && <View style={s.card}><Text style={s.title}>{brl(overview.monthly)} / mês</Text><Text style={s.text}>{brl(overview.annual)} / ano</Text><Text style={s.hint}>Custo equivalente das despesas recorrentes cadastradas, inclusive as que começam no futuro. O valor anual considera 12 meses de continuidade; a previsão respeita a data de encerramento.</Text></View>}
      <Pressable accessibilityRole="button" style={s.button} onPress={onNew}><Text style={s.text}>+ Cadastrar assinatura</Text></Pressable>
      {overview?.subscriptions.map(item => <View key={item.id} style={s.card}><Text style={s.title}>{item.name}</Text><Text style={s.text}>{brl(item.amount)} {item.recurrence === 'monthly' ? 'por mês' : 'por ano'}</Text><Text style={s.hint}>Equivale a {brl(item.monthly)} / mês · {brl(item.annual)} / ano</Text><Text style={s.hint}>Desde {dateBr(item.starts)}{item.until ? ' · até ' + dateBr(item.until) : ' · sem data final'}</Text><View style={s.row}><Pressable disabled={busy} accessibilityRole="button" style={s.button} onPress={() => void openTransaction(item.id)}><Text style={s.text}>Ver / editar</Text></Pressable><Pressable disabled={busy} accessibilityRole="button" style={s.button} onPress={() => confirmDestructive('Encerrar repetição?', 'Os lançamentos já criados serão mantidos. Isso só encerra a repetição no app; não cancela o serviço contratado.', 'Encerrar', () => void stopSubscription(item.id))}><Text style={s.error}>Encerrar</Text></Pressable></View></View>)}
      {overview && !overview.subscriptions.length && <Text style={s.hint}>Cadastre academia, streaming ou outra despesa com repetição mensal ou anual.</Text>}
    </>}
    {section === 'Metas' && <>
      {overview && <View style={s.card}><Text style={s.hint}>Saldo total realizado</Text><Text style={s.title}>{brl(overview.balance)}</Text><Text style={s.text}>Reservado: {brl(overview.reserved)}</Text><Text style={[s.title, { color: overview.available < 0 ? colors.expense : colors.income }]}>Livre: {brl(overview.available)}</Text><Text style={s.hint}>Reservar não é gastar: apenas separa parte do saldo. Diminuir a reserva devolve dinheiro ao saldo livre, sem criar receita.</Text>{overview.available < 0 && <Text style={s.error}>Seu saldo caiu abaixo das reservas. Revise as metas ou os lançamentos.</Text>}</View>}
      <Pressable accessibilityRole="button" style={s.button} onPress={() => edit()}><Text style={s.text}>+ Nova meta ou reserva</Text></Pressable>
      {overview?.goals.map(goal => <View key={goal.id} style={s.card}><Text style={s.title}>{goal.name}</Text><Text style={s.text}>{brl(goal.reserved)} de {brl(goal.target)}</Text><View style={s.track}><View style={{ width: `${Math.min(100, goal.reserved / goal.target * 100)}%`, height: 7, backgroundColor: colors.income }} /></View><Text style={s.hint}>{goal.reserved >= goal.target ? 'Meta alcançada' : 'Faltam ' + brl(goal.target - goal.reserved)}</Text><View style={s.row}><Pressable disabled={busy} accessibilityRole="button" style={s.button} onPress={() => edit(goal)}><Text style={s.text}>Editar / reservar</Text></Pressable><Pressable disabled={busy} accessibilityRole="button" style={s.button} onPress={() => confirmDestructive('Excluir meta?', 'O dinheiro reservado volta ao saldo livre. Nenhuma despesa ou receita será criada.', 'Excluir', () => void deleteGoal(goal.id))}><Text style={s.error}>Excluir</Text></Pressable></View></View>)}
    </>}
    <Modal transparent animationType="slide" visible={!!editor} onRequestClose={() => { if (!busy) setEditor(null) }}><View style={s.backdrop}><ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: '90%', flexGrow: 0 }} contentContainerStyle={[s.sheet, { paddingBottom: insets.bottom + 24 }]}>
      <Text style={s.title}>{editor?.goal ? 'Editar meta e reserva' : 'Nova meta'}</Text>
      <Text style={s.text}>Nome</Text><TextInput accessibilityLabel="Nome da meta" value={name} onChangeText={setName} maxLength={100} style={s.input} placeholder="Reserva de emergência, viagem…" placeholderTextColor={colors.faint} />
      <Text style={s.text}>Quero juntar (R$)</Text><TextInput accessibilityLabel="Valor da meta" value={target} onChangeText={setTarget} maxLength={12} keyboardType="decimal-pad" style={s.input} />
      <Text style={s.text}>Total que desejo deixar reservado (R$)</Text><TextInput accessibilityLabel="Total reservado" value={reserved} onChangeText={setReserved} maxLength={12} keyboardType="decimal-pad" style={s.input} /><Text style={s.hint}>Informe o total, não só o acréscimo. Para liberar tudo, coloque zero.</Text>
      {editError ? <Text accessibilityRole="alert" style={s.error}>{editError}</Text> : null}
      <Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={() => void persist()}><Text style={s.text}>{busy ? 'Salvando…' : 'Salvar meta'}</Text></Pressable><Pressable accessibilityRole="button" disabled={busy} style={s.button} onPress={() => setEditor(null)}><Text style={s.hint}>Cancelar</Text></Pressable>
    </ScrollView></View></Modal>
  </View>
}
const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 20, padding: 20, gap: 12 }, title: { color: colors.text, fontSize: 18, fontWeight: '600' }, text: { color: colors.text, fontSize: 15, lineHeight: 22 }, hint: { color: colors.muted, fontSize: 13, lineHeight: 20 }, error: { color: colors.expense, fontSize: 14, lineHeight: 22 }, row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, button: { minHeight: 48, padding: 12, justifyContent: 'center', borderRadius: 12, backgroundColor: colors.cardHigh }, track: { height: 7, backgroundColor: colors.cardHigh, borderRadius: 4, overflow: 'hidden' }, input: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, fontSize: 18 }, backdrop: { flex: 1, backgroundColor: '#0007', justifyContent: 'flex-end' }, sheet: { padding: 24, gap: 14, backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
})
