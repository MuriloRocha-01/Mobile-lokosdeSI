import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { TransactionCategory, TransactionType } from '../@types/api'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import { createTransaction, errorMessage, getCategories } from '../services/api'
import { pickStatement } from '../services/statementFile'
import { existingForStatement } from '../services/statementImport'
import { guessMapping, parseCsv, parseOfx, possibleDuplicates, readCsv } from '../services/statementParser'
import type { CsvMapping, CsvTable, StatementRow } from '../services/statementParser'

export function ImportStatementScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme(); const styles = createStyles(colors); const insets = useSafeAreaInsets()
  const [bank, setBank] = useState('Nubank')
  const [name, setName] = useState('')
  const [csv, setCsv] = useState<CsvTable | null>(null)
  const [mapping, setMapping] = useState<CsvMapping | null>(null)
  const [rows, setRows] = useState<StatementRow[]>([])
  const [categories, setCategories] = useState<TransactionCategory[]>([])
  const [defaults, setDefaults] = useState<Record<TransactionType, number>>({ income: 0, expense: 0 })
  const [assignments, setAssignments] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [duplicates, setDuplicates] = useState<Set<string>>(new Set())
  const [saved, setSaved] = useState<Set<string>>(new Set())
  const savedRef = useRef(new Set<string>())
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [message, setMessage] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    const handler = BackHandler.addEventListener('hardwareBackPress', () => { if (!busyRef.current) onClose(); return true })
    return () => handler.remove()
  }, [onClose])

  function working(value: boolean) { busyRef.current = value; setBusy(value) }
  async function preview(items: StatementRow[]) {
    const [existing, available] = await Promise.all([existingForStatement(items), getCategories()])
    const matches = possibleDuplicates(items, existing)
    setCategories(available); setDuplicates(matches); setRows(items)
    setSelected(new Set(items.filter(item => !matches.has(item.key) && !savedRef.current.has(item.key)).map(item => item.key)))
    setDefaults(previous => ({ income: available.some(c => c.id === previous.income && c.type === 'income') ? previous.income : 0, expense: available.some(c => c.id === previous.expense && c.type === 'expense') ? previous.expense : 0 }))
    setUncertain(false)
  }
  async function chooseFile() {
    if (busyRef.current) return
    // Abrir o seletor diretamente no toque é necessário também no navegador.
    const picking = pickStatement()
    working(true); setMessage('')
    try {
      const file = await picking
      if (!file) return
      setRows([]); setCsv(null); setMapping(null); setAssignments({}); setSaved(new Set()); savedRef.current = new Set(); setSelected(new Set()); setUncertain(false); setName(file.name)
      if (/\.csv$/i.test(file.name)) { const table = readCsv(file.content); setCsv(table); setMapping(guessMapping(table.headers)) }
      else await preview(parseOfx(file.content))
    } catch (error) { setMessage(errorMessage(error)) }
    finally { working(false) }
  }
  async function review() {
    if (busyRef.current) return
    working(true); setMessage('')
    try { await preview(csv && mapping ? parseCsv(csv, mapping) : rows) }
    catch (error) { setMessage(errorMessage(error)) }
    finally { working(false) }
  }
  const chosen = rows.filter(row => selected.has(row.key) && !saved.has(row.key))
  const categoryFor = (row: StatementRow) => assignments[row.key] ?? defaults[row.type]
  const missingCategory = chosen.some(row => !categories.some(c => c.id === categoryFor(row) && c.type === row.type))
  async function save() {
    if (busyRef.current || uncertain || !chosen.length || missingCategory) return
    working(true); setMessage('')
    try {
      for (const row of chosen) {
        await createTransaction({ description: row.description, amount: row.cents / 100, date: row.date, type: row.type, category_id: categoryFor(row), recurrence: 'none' })
        savedRef.current.add(row.key); setSaved(new Set(savedRef.current))
        setSelected(previous => { const next = new Set(previous); next.delete(row.key); return next })
      }
      setMessage(`${savedRef.current.size} lançamento(s) importado(s). Você já pode voltar ao extrato.`)
    } catch (error) {
      setUncertain(true)
      setMessage(`${savedRef.current.size} lançamento(s) confirmado(s). ${errorMessage(error)} Confira novamente antes de continuar: a última resposta pode ter se perdido.`)
    } finally { working(false) }
  }
  function option(label: string, active: boolean, action: () => void) {
    return <Pressable key={label} disabled={busy} onPress={action} accessibilityRole="button" accessibilityState={{ selected: active, disabled: busy }} style={[styles.chip, active && styles.active]}><Text style={[styles.chipText, active && { color: colors.primary }]}>{label}</Text></Pressable>
  }
  function categoryOptions(type: TransactionType, value: number, action: (id: number) => void) {
    return <View style={styles.wrap}>{categories.filter(c => c.type === type).map(c => option(c.name, value === c.id, () => action(c.id)))}</View>
  }
  const header = <View style={styles.header}>
    <View style={styles.heading}><Pressable onPress={onClose} disabled={busy} accessibilityRole="button" accessibilityLabel="Voltar" style={styles.back}><MaterialCommunityIcons name="arrow-left" color={colors.text} size={24} /></Pressable><Text style={styles.title}>Importar extrato</Text></View>
    <Text style={styles.note}>Traga seus lançamentos da CAIXA ou do Nubank. Revise os valores e as categorias antes de salvar.</Text>
    <View style={styles.card}><Text style={styles.label}>Banco de origem</Text><View style={styles.wrap}>{['Nubank', 'CAIXA'].map(b => option(b, bank === b, () => setBank(b)))}</View>
      <Pressable onPress={() => void chooseFile()} disabled={busy || uncertain} accessibilityRole="button" style={styles.button}><MaterialCommunityIcons name="file-upload-outline" size={23} color={colors.onPrimary} /><Text style={styles.buttonText}>{name ? 'Trocar arquivo' : 'Selecionar OFX ou CSV'}</Text></Pressable>
      <Text style={styles.note}>{name || 'Até 2 MB e 1.000 lançamentos. Arquivo em UTF-8 e valores em reais.'}</Text>
    </View>
    {csv && mapping && !rows.length ? <View style={styles.card}>
      <Text style={styles.label}>Confira as colunas do CSV</Text>
      <Text style={styles.note}>Os formatos mudam entre conta e fatura. Escolha como ler este arquivo.</Text>
      {(['date', 'description', 'amount'] as const).map(field => <View key={field}><Text style={styles.label}>{({ date: 'Data', description: 'Descrição', amount: 'Valor' })[field]}</Text><View style={styles.wrap}>{field === 'amount' && option('Débito e crédito separados', mapping.amount < 0, () => setMapping({ ...mapping, amount: -1 }))}{csv.headers.map((h, i) => option(`${i + 1}. ${h}`, mapping[field] === i, () => setMapping({ ...mapping, [field]: i })))}</View></View>)}
      {mapping.amount < 0 && (['debit', 'credit'] as const).map(field => <View key={field}><Text style={styles.label}>{field === 'debit' ? 'Débito' : 'Crédito'}</Text><View style={styles.wrap}>{csv.headers.map((h, i) => option(`${i + 1}. ${h}`, mapping[field] === i, () => setMapping({ ...mapping, [field]: i })))}</View></View>)}
      <Text style={styles.label}>Separador decimal</Text><View style={styles.wrap}>{option('Vírgula: 1.234,56', mapping.decimal === ',', () => setMapping({ ...mapping, decimal: ',' }))}{option('Ponto: 1234.56', mapping.decimal === '.', () => setMapping({ ...mapping, decimal: '.' }))}</View>
      {mapping.amount >= 0 && <><Text style={styles.label}>Sinal dos valores</Text><View style={styles.wrap}>{option('Conta: negativo é despesa', !mapping.card, () => setMapping({ ...mapping, card: false }))}{option('Fatura: positivo é despesa', mapping.card, () => setMapping({ ...mapping, card: true }))}</View></>}
      <Text style={styles.note}>Primeira linha: {csv.rows[0].join(' · ')}</Text>
      <Pressable onPress={() => void review()} disabled={busy} accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>Revisar lançamentos</Text></Pressable>
    </View> : null}
    {rows.length ? <View style={styles.card}>
      <Text style={styles.label}>{rows.length} lançamento(s) para revisar</Text>
      <Text style={styles.note}>{duplicates.size} possível(is) duplicado(s), desmarcado(s). Mesma data, descrição e valor podem representar compras diferentes. Marque apenas se reconhecer o lançamento.</Text>
      {(['expense', 'income'] as const).filter(type => rows.some(row => row.type === type)).map(type => <View key={type}><Text style={styles.label}>{type === 'expense' ? 'Categoria para despesas' : 'Categoria para receitas'}</Text>{categoryOptions(type, defaults[type], id => setDefaults({ ...defaults, [type]: id }))}{!categories.some(c => c.type === type) && <Text style={styles.note}>Crie uma categoria em Novo lançamento antes de importar.</Text>}</View>)}
      <Text style={styles.note}>Selecionados: {chosen.length} · Receitas: R$ {(chosen.filter(r => r.type === 'income').reduce((n, r) => n + r.cents, 0) / 100).toFixed(2).replace('.', ',')} · Despesas: R$ {(chosen.filter(r => r.type === 'expense').reduce((n, r) => n + r.cents, 0) / 100).toFixed(2).replace('.', ',')}</Text>
      {missingCategory && <Text style={styles.note}>Escolha uma categoria para cada tipo selecionado.</Text>}
      <Pressable onPress={() => void (uncertain ? review() : save())} disabled={busy || (!uncertain && (!chosen.length || missingCategory))} accessibilityRole="button" style={[styles.button, (busy || (!uncertain && (!chosen.length || missingCategory))) && { opacity: 0.45 }]}><Text style={styles.buttonText}>{uncertain ? 'Verificar novamente no servidor' : `Importar ${chosen.length} selecionado(s)`}</Text></Pressable>
      {!busy && !uncertain && !saved.size && csv && <Pressable onPress={() => { setRows([]); setSelected(new Set()) }} accessibilityRole="button" style={styles.chip}><Text style={styles.chipText}>Ajustar colunas</Text></Pressable>}
    </View> : null}
    {busy && <View style={styles.heading}><ActivityIndicator color={colors.primary} /><Text style={styles.note}>Processando… {saved.size ? `${saved.size} confirmado(s)` : ''}</Text></View>}
    {!!message && <Text style={styles.message} accessibilityRole="alert">{message}</Text>}
  </View>
  return <FlatList style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }} data={rows} keyExtractor={row => row.key} ListHeaderComponent={header} renderItem={({ item }) => <View style={styles.item}>
    <Pressable disabled={busy || uncertain || saved.has(item.key)} onPress={() => setSelected(previous => { const next = new Set(previous); next.has(item.key) ? next.delete(item.key) : next.add(item.key); return next })} accessibilityRole="checkbox" accessibilityLabel={`${item.description}, ${item.date}, R$ ${(item.cents / 100).toFixed(2)}`} accessibilityState={{ checked: selected.has(item.key), disabled: busy || uncertain || saved.has(item.key) }} aria-checked={selected.has(item.key)} style={styles.heading}>
      <MaterialCommunityIcons name={saved.has(item.key) ? 'check-circle-outline' : selected.has(item.key) ? 'checkbox-marked' : 'checkbox-blank-outline'} size={24} color={saved.has(item.key) ? colors.income : colors.primary} />
      <View style={{ flex: 1 }}><Text style={styles.description}>{item.description}</Text><Text style={styles.note}>{item.date.split('-').reverse().join('/')} · {saved.has(item.key) ? 'Importado' : duplicates.has(item.key) ? 'Possível duplicado' : item.type === 'income' ? 'Receita' : 'Despesa'}</Text></View>
      <Text style={[styles.amount, { color: item.type === 'income' ? colors.income : colors.expense }]}>{item.type === 'expense' ? '−' : '+'} R$ {(item.cents / 100).toFixed(2).replace('.', ',')}</Text>
    </Pressable>
    {!saved.has(item.key) && <Pressable disabled={busy || uncertain} onPress={() => setExpanded(expanded === item.key ? null : item.key)} accessibilityRole="button" style={styles.chip}><Text style={styles.chipText}>Categoria: {categories.find(c => c.id === categoryFor(item))?.name ?? 'Escolher'} ▾</Text></Pressable>}
    {expanded === item.key && categoryOptions(item.type, categoryFor(item), id => { setAssignments({ ...assignments, [item.key]: id }); setExpanded(null) })}
  </View>} />
}

const createStyles = (c: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg }, header: { gap: 16, paddingBottom: 16 }, heading: { flexDirection: 'row', alignItems: 'center', gap: 12 }, back: { minWidth: 44, minHeight: 44, justifyContent: 'center' }, title: { flex: 1, color: c.text, fontSize: 26, fontWeight: '700' }, note: { color: c.muted, fontSize: 13, lineHeight: 20 }, label: { color: c.text, fontSize: 16, fontWeight: '600' }, card: { backgroundColor: c.card, borderRadius: 24, padding: 18, gap: 12, borderWidth: 1, borderColor: c.border }, wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, chip: { minHeight: 44, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border, justifyContent: 'center' }, active: { backgroundColor: c.primarySoft, borderColor: c.primary }, chipText: { color: c.text, fontSize: 13 }, button: { backgroundColor: c.primary, borderRadius: 16, minHeight: 52, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: c.onPrimary, fontSize: 15, fontWeight: '700', textAlign: 'center' }, message: { color: c.text, fontSize: 14, lineHeight: 22, padding: 14, borderRadius: 16, backgroundColor: c.primarySoft }, item: { borderBottomWidth: 1, borderColor: c.border, paddingVertical: 16, gap: 10 }, description: { color: c.text, fontSize: 15, fontWeight: '600' }, amount: { fontWeight: '600', fontSize: 13 },
})
