import { FinanceManagement } from '../components/FinanceManagement'
import type { Transaction } from '../types'
import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage, getPlanning, removeBudget, saveBudget, saveCardCycle } from '../api'
import { dateBr, parseAmountText } from '../calendarUtils'
import { CategoryBadge } from '../components/CategoryBadge'
import { Chip } from '../components/Chip'
import { confirmDestructive } from '../confirm'
import { brl, monthTitle, todayIso } from '../format'
import { colors } from '../theme'
import type { PlanningData } from '../types'

type Editor = { kind: 'budget' | 'card'; id: number; name: string }
export function PlanningScreen({ onClose, onOpen, onNew, onChanged }: { onClose: () => void; onOpen: (item: Transaction) => void; onNew: () => void; onChanged: () => void }) {
  const insets = useSafeAreaInsets()
  const [data, setData] = useState<PlanningData | null>(null)
  const [section, setSection] = useState('Previsão')
  const [month, setMonth] = useState(todayIso().slice(0, 7))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [first, setFirst] = useState('')
  const [second, setSecond] = useState('')
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState('')
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try { setData(await getPlanning(todayIso())) } catch (err) { setError(errorMessage(err)) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])
  const open = (next: Editor, value = '', other = '') => { setEditor(next); setFirst(value); setSecond(other); setEditError('') }
  async function save(remove = false) {
    if (!editor || saving) return
    const value = parseAmountText(first)
    if (!remove && editor.kind === 'budget' && (!value || value <= 0)) { setEditError('Informe um limite maior que zero.'); return }
    if (editor.kind === 'card' && ![first, second].every(v => /^\d{1,2}$/.test(v) && Number(v) >= 1 && Number(v) <= 31)) { setEditError('Informe dias entre 1 e 31.'); return }
    setSaving(true); setEditError('')
    try {
      if (editor.kind === 'card') await saveCardCycle(editor.id, Number(first), Number(second))
      else if (remove) await removeBudget(editor.id)
      else await saveBudget(editor.id, value!)
      setEditor(null); await load()
    } catch (err) { setEditError(errorMessage(err)) }
    finally { setSaving(false) }
  }
  return <View style={s.root}>
    <ScrollView contentContainerStyle={{ padding: 20, paddingTop: insets.top + 8, paddingBottom: insets.bottom + 32, gap: 18 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} />}>
      <View style={s.row}><Pressable accessibilityRole="button" accessibilityLabel="Voltar" onPress={onClose} style={s.button}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} /></Pressable><Text style={s.title}>Planejamento</Text></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{['Previsão', 'Contas', 'Assinaturas', 'Metas', 'Limites', 'Faturas'].map(label => <Chip key={label} label={label} selected={section === label} onPress={() => setSection(label)} />)}</ScrollView>
      {error ? <Pressable accessibilityRole="button" onPress={() => void load()}><Text style={s.expense}>{error}</Text><Text style={s.text}>Tentar novamente</Text></Pressable> : null}
      {!data && loading && <ActivityIndicator color={colors.text} />}
      {['Contas', 'Assinaturas', 'Metas'].includes(section) && <FinanceManagement section={section} onOpen={onOpen} onNew={onNew} onChanged={() => { void load(); onChanged() }} />}
      {data && section === 'Previsão' && <>
        <Text style={s.hint}>Previsão das contas pendentes e repetições. Pendências vencidas continuam neste mês até você confirmar a baixa. Não consulta seu banco.</Text>
        <View style={s.card}><Text style={s.hint}>Saldo realizado até hoje</Text><Text style={s.amount}>{brl(data.opening)}</Text><Text style={s.hint}>Saldo de pagamentos e recebimentos confirmados. A previsão usa o vencimento das pendências; reservas continuam pertencendo ao saldo total.</Text></View>
        {data.forecast.map(item => <View key={item.month} style={s.card}>
          <Text style={s.heading}>{monthTitle(item.month)}</Text>
          <View style={s.between}><Text style={s.hint}>Entradas previstas</Text><Text style={s.income}>+ {brl(item.income)}</Text></View>
          <View style={s.between}><Text style={s.hint}>Contas e parcelas</Text><Text style={s.expense}>− {brl(item.expense)}</Text></View>
          <View style={[s.between, s.divider]}><Text style={s.text}>Saldo projetado</Text><Text style={[s.heading, { color: item.balance < 0 ? colors.expense : colors.income }]}>{brl(item.balance)}</Text></View>
          {item.balance < 0 && <Text style={s.expense}>As saídas cadastradas superam os recursos previstos.</Text>}
        </View>)}
      </>}
      {data && section === 'Limites' && <>
        <Text style={s.heading}>{monthTitle(data.today.slice(0, 7))}</Text>
        <Text style={s.hint}>Despesas pagas até hoje, pela data da baixa. O limite se repete a cada mês e não bloqueia despesas.</Text>
        {data.budgets.map(item => <Pressable key={item.category_id} accessibilityRole="button" accessibilityLabel={'Editar limite de ' + item.name} style={s.card} onPress={() => open({ kind: 'budget', id: item.category_id, name: item.name }, item.limit?.toFixed(2).replace('.', ',') ?? '')}>
          <View style={s.between}><View style={[s.row, { flex: 1 }]}><CategoryBadge icon={item.icon} color={item.color} size={20} /><Text style={[s.heading, { flex: 1 }]}>{item.name}</Text></View><MaterialCommunityIcons name="pencil-outline" size={18} color={colors.muted} /></View>
          <Text style={s.text}>{brl(item.spent)}{item.limit !== null ? ' de ' + brl(item.limit) : ' · Definir limite'}</Text>
          {item.limit !== null && <><View style={s.track}><View style={{ height: 6, width: `${Math.min(100, item.spent / item.limit * 100)}%`, backgroundColor: item.spent > item.limit ? colors.expense : item.color }} /></View><Text style={item.spent > item.limit ? s.expense : s.hint}>{item.spent > item.limit ? 'Limite excedido em ' + brl(item.spent - item.limit) : 'Restam ' + brl(item.limit - item.spent)}</Text></>}
        </Pressable>)}
      </>}
      {data && section === 'Faturas' && <>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{data.forecast.map(item => <Chip key={item.month} label={monthTitle(item.month)} selected={month === item.month} onPress={() => setMonth(item.month)} />)}</ScrollView>
        <Text style={s.hint}>Somente crédito. Compras até o fechamento entram na fatura atual; depois, na próxima. Parcelas usam o vencimento informado. A fatura agrupa os lançamentos sem criar outra despesa.</Text>
        {!data.cards.length && <Text style={s.hint}>Adicione um cartão ao registrar uma transação ou na sua conta.</Text>}
        {data.cards.map(card => {
          const invoice = data.invoices.find(item => item.card_id === card.id && item.month === month)
          return <View key={card.id} style={s.card}>
            <View style={s.between}><Text style={[s.heading, { flex: 1 }]}>{card.name}{card.last_four ? ' · ' + card.last_four : ''}</Text><Pressable style={s.button} accessibilityRole="button" accessibilityLabel={'Configurar fatura ' + card.name} onPress={() => open({ kind: 'card', id: card.id, name: card.name }, card.closing_day?.toString() ?? '', card.due_day?.toString() ?? '')}><MaterialCommunityIcons name="pencil-outline" size={20} color={colors.text} /></Pressable></View>
            {card.closing_day ? <><Text style={s.hint}>Fecha dia {card.closing_day} · vence dia {card.due_day}</Text><Text style={s.amount}>{brl(invoice?.total ?? 0)}</Text>{invoice && <Text style={s.hint}>Vencimento: {dateBr(invoice.due)}</Text>}{!invoice?.items.length && <Text style={s.hint}>Nenhuma despesa prevista nesta fatura.</Text>}{invoice?.items.map((item, index) => <View key={index} style={s.divider}><Text style={s.text}>{item.description}</Text><View style={s.between}><Text style={s.hint}>{dateBr(item.date)}{item.projected || item.status === 'pending' ? ' · Pendente' : ' · Paga'}</Text><Text style={s.expense}>{brl(item.amount)}</Text></View></View>)}</> : <Pressable accessibilityRole="button" onPress={() => open({ kind: 'card', id: card.id, name: card.name })}><Text style={s.text}>Configurar fechamento e vencimento →</Text></Pressable>}
          </View>
        })}
      </>}
    </ScrollView>
    <Modal transparent visible={editor !== null} animationType="slide" onRequestClose={() => { if (!saving) setEditor(null) }}>
      <View style={s.backdrop}><ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={[s.sheet, { paddingBottom: insets.bottom + 24 }]} style={{ maxHeight: '85%', flexGrow: 0 }}>
        <View style={s.between}><Text style={[s.heading, { flex: 1 }]}>{editor?.name}</Text><Pressable disabled={saving} accessibilityRole="button" accessibilityLabel="Fechar edição" style={s.button} onPress={() => setEditor(null)}><MaterialCommunityIcons name="close" size={22} color={colors.text} /></Pressable></View>
        <Text style={s.text}>{editor?.kind === 'budget' ? 'Limite mensal (R$)' : 'Dia do fechamento'}</Text>
        <TextInput accessibilityLabel={editor?.kind === 'budget' ? 'Limite mensal em reais' : 'Dia do fechamento'} value={first} onChangeText={setFirst} keyboardType={editor?.kind === 'budget' ? 'decimal-pad' : 'number-pad'} maxLength={editor?.kind === 'budget' ? 12 : 2} style={s.input} />
        {editor?.kind === 'card' && <><Text style={s.text}>Dia do vencimento</Text><TextInput accessibilityLabel="Dia do vencimento" value={second} onChangeText={setSecond} keyboardType="number-pad" maxLength={2} style={s.input} /><Text style={s.hint}>Em meses curtos usamos o último dia. Vencimento anterior ou igual ao fechamento fica no mês seguinte. Alterar recalcula as estimativas.</Text></>}
        {editError ? <Text accessibilityRole="alert" style={s.expense}>{editError}</Text> : null}
        <Pressable disabled={saving} accessibilityRole="button" style={s.save} onPress={() => void save()}>{saving ? <ActivityIndicator color="#fff" /> : <Text style={s.saveText}>Salvar</Text>}</Pressable>
        {editor?.kind === 'budget' && <Pressable disabled={saving} accessibilityRole="button" style={s.button} onPress={() => confirmDestructive('Remover limite?', 'As despesas serão mantidas.', 'Remover', () => void save(true))}><Text style={s.expense}>Remover limite</Text></Pressable>}
      </ScrollView></View>
    </Modal>
  </View>
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  title: { color: colors.text, fontSize: 24, fontWeight: '700' }, heading: { color: colors.text, fontSize: 17, fontWeight: '600' }, amount: { color: colors.text, fontSize: 28, fontWeight: '700' }, text: { color: colors.text, fontSize: 15, lineHeight: 22 }, hint: { color: colors.muted, fontSize: 13, lineHeight: 20 }, income: { color: colors.income, fontSize: 15 }, expense: { color: colors.expense, fontSize: 15, lineHeight: 22 },
  card: { padding: 20, borderRadius: 20, backgroundColor: colors.card, gap: 12 }, divider: { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.border, paddingTop: 14, gap: 8 }, track: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: colors.cardHigh }, button: { minHeight: 44, minWidth: 44, justifyContent: 'center', alignItems: 'center' }, input: { padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 12, color: colors.text, fontSize: 18 }, save: { padding: 16, alignItems: 'center', backgroundColor: colors.primary, borderRadius: 14 }, saveText: { color: '#fff', fontWeight: '600', fontSize: 16 }, backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0007' }, sheet: { backgroundColor: colors.card, padding: 24, gap: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
})
