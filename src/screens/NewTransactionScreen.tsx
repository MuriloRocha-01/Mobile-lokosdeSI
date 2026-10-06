import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dateBr, parseAmountText } from '../calendarUtils'
import { createTransaction, errorMessage, getCategories, updateTransaction } from '../api'
import { CategoryBadge } from '../components/CategoryBadge'
import { CategoryFormModal } from '../components/CategoryFormModal'
import { Chip } from '../components/Chip'
import { DateSheet } from '../components/DateSheet'
import { brl, todayIso, yesterdayIso } from '../format'
import { success, tap, warning } from '../haptics'
import * as storage from '../storage'
import { colors, radius } from '../theme'
import type { Transaction, TransactionCategory, TransactionRecurrence, TransactionType } from '../types'

const lastCategoryKey = (type: TransactionType) => `ecossistema.lastCategory.${type}`

interface Props {
  /** A transação sendo editada; ausente/null = lançamento novo. */
  transaction?: Transaction | null
  onClose: () => void
  /** Chamado depois de gravar no servidor, com a frase para mostrar na lista ("Despesa de R$ 12,50 salva"). */
  onSaved: (message: string) => void
}

const TYPE_META: Record<TransactionType, { label: string; color: string }> = {
  expense: { label: 'Despesa', color: colors.expense },
  income: { label: 'Receita', color: colors.income },
}

/**
 * Lançar (ou editar) uma despesa/receita: um formulário normal, de cima para baixo — tipo, valor (teclado
 * padrão do celular), motivo (categoria, com emoji; dá pra criar as suas), data (com calendário), descrição e,
 * se for um gasto fixo, repetir todo mês/ano até uma data (calendário também).
 */
export function NewTransactionScreen({ transaction = null, onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets()
  // Ocorrência lançada automaticamente por uma repetição: a repetição só se mexe na transação original (backend).
  const isGeneratedOccurrence = transaction?.recurrence_parent_id != null
  const [type, setType] = useState<TransactionType>(transaction?.type ?? 'expense')
  const [amountText, setAmountText] = useState(transaction ? transaction.amount.toFixed(2).replace('.', ',') : '')
  const [categories, setCategories] = useState<TransactionCategory[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState<Partial<Record<TransactionType, number>>>(transaction ? { [transaction.type]: transaction.category_id } : {})
  const [remembered, setRemembered] = useState<Partial<Record<TransactionType, number>>>({})
  const [date, setDate] = useState(transaction?.date ?? todayIso())
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [recurrence, setRecurrence] = useState<TransactionRecurrence>(transaction?.recurrence ?? 'none')
  const [until, setUntil] = useState<string | null>(transaction?.recurrence_until ?? null)
  const [pickDate, setPickDate] = useState<'date' | 'until' | null>(null)
  const [catModal, setCatModal] = useState<{ category: TransactionCategory | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const loadCategories = useCallback(async () => {
    setLoadError('')
    try {
      setCategories(await getCategories())
    } catch (err) {
      setLoadError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    void loadCategories()
    // A última categoria usada de cada tipo já vem marcada.
    void (async () => {
      const [expense, income] = await Promise.all([storage.getItem(lastCategoryKey('expense')), storage.getItem(lastCategoryKey('income'))])
      setRemembered({ expense: expense ? Number(expense) : undefined, income: income ? Number(income) : undefined })
    })()
  }, [loadCategories])

  const options = useMemo(() => (categories ?? []).filter((c) => c.type === type), [categories, type])
  const selectedId = chosen[type] ?? (options.some((c) => c.id === remembered[type]) ? remembered[type] : undefined)
  const selected = options.find((c) => c.id === selectedId) ?? null
  const hasCustomCategory = options.some((c) => !c.is_default)

  const amount = parseAmountText(amountText) ?? 0
  const { color, label } = TYPE_META[type]
  const canSave = amount > 0 && selected !== null && !saving
  const today = todayIso()
  const yesterday = yesterdayIso()
  const repeating = recurrence !== 'none'

  /** Só aceita o que ainda é um valor válido: letras, 3ª casa decimal ou mais de 9 dígitos são recusados (o texto não muda). */
  function onAmountChange(text: string) {
    setError('')
    const cleaned = text.replace(/[^0-9.,]/g, '')
    if (cleaned === '' || parseAmountText(cleaned) !== null) setAmountText(cleaned)
  }

  function chooseDate(iso: string) {
    setDate(iso)
    if (until && until < iso) setUntil(null) // o fim não pode ficar antes do começo
  }

  function toggleRepeat(on: boolean) {
    tap()
    setRecurrence(on ? 'monthly' : 'none')
    if (!on) setUntil(null)
  }

  function onCategorySaved(saved: TransactionCategory) {
    setCategories((current) => [...(current ?? []).filter((c) => c.id !== saved.id), saved])
    setChosen((current) => ({ ...current, [saved.type]: saved.id }))
    if (saved.type !== type) setType(saved.type)
  }

  function onCategoryDeleted(id: number) {
    setCategories((current) => (current ?? []).filter((c) => c.id !== id))
    setChosen((current) => (current[type] === id ? { ...current, [type]: undefined } : current))
  }

  async function save() {
    if (!selected || amount <= 0 || saving) return
    setSaving(true)
    setError('')
    const fields = {
      description: description.trim(), // vazio: o servidor usa o nome da categoria
      amount,
      date,
      type,
      category_id: selected.id,
      ...(isGeneratedOccurrence ? {} : { recurrence, recurrence_until: repeating ? until : null }),
    }
    try {
      if (transaction) await updateTransaction(transaction.id, fields)
      else await createTransaction(fields)
      void storage.setItem(lastCategoryKey(type), String(selected.id))
      success()
      onSaved(transaction ? `${label} atualizada` : `${label} de ${brl(amount)} salva em ${selected.name}`)
    } catch (err) {
      warning()
      setError(errorMessage(err))
      setSaving(false)
    }
  }

  const repeatHint = repeating
    ? `Lança sozinho ${recurrence === 'monthly' ? `todo dia ${Number(date.slice(8))} do mês` : `todo dia ${date.slice(8)}/${date.slice(5, 7)} do ano`}${until ? ` até ${dateBr(until)}` : ', sem data para acabar'}.`
    : ''

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.screen, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 28 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        <View style={styles.topBar}>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Fechar" hitSlop={12} style={styles.close}>
            <MaterialCommunityIcons name="close" size={26} color={colors.text} />
          </Pressable>
          <Text style={styles.heading}>{transaction ? 'Editar transação' : 'Nova transação'}</Text>
          <View style={styles.close} />
        </View>

        {/* Despesa / Receita */}
        <View style={styles.toggle} accessibilityRole="radiogroup">
          {(['expense', 'income'] as const).map((option) => {
            const active = type === option
            return (
              <Pressable
                key={option}
                accessibilityRole="radio"
                accessibilityState={{ checked: active }}
                onPress={() => {
                  tap()
                  setType(option)
                }}
                style={[styles.toggleItem, active && { backgroundColor: `${TYPE_META[option].color}26`, borderColor: TYPE_META[option].color }]}
              >
                <Text style={[styles.toggleText, active && { color: TYPE_META[option].color }]}>{TYPE_META[option].label}</Text>
              </Pressable>
            )
          })}
        </View>

        {/* O valor, no teclado padrão do celular */}
        <View style={styles.amountCard}>
          <Text style={styles.amountLabel}>Valor</Text>
          <View style={styles.amountRow}>
            <Text style={[styles.currency, { color: amount > 0 ? color : colors.faint }]}>R$</Text>
            <TextInput
              value={amountText}
              onChangeText={onAmountChange}
              placeholder="0,00"
              placeholderTextColor={colors.faint}
              keyboardType="decimal-pad"
              returnKeyType="done"
              maxLength={14}
              autoFocus={!transaction}
              selectTextOnFocus
              accessibilityLabel="Valor em reais"
              style={[styles.amountInput, { color: amount > 0 ? color : colors.text }]}
            />
          </View>
        </View>

        {/* Motivo (categoria) */}
        <Text style={styles.label}>Motivo</Text>
        {categories === null ? (
          loadError ? (
            <Pressable onPress={() => void loadCategories()} style={styles.retry}>
              <Text style={styles.retryText}>{loadError}</Text>
              <Text style={styles.retryAction}>Tocar para tentar de novo</Text>
            </Pressable>
          ) : (
            <ActivityIndicator color={colors.muted} style={styles.loading} />
          )
        ) : (
          <>
            <View style={styles.chips}>
              {options.map((category) => {
                const on = category.id === selected?.id
                return (
                  <Pressable
                    key={category.id}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: on }}
                    onPress={() => {
                      tap()
                      setChosen((current) => ({ ...current, [type]: category.id }))
                    }}
                    onLongPress={category.is_default ? undefined : () => setCatModal({ category })}
                    delayLongPress={400}
                    style={[styles.chip, on && { backgroundColor: `${category.color}2b`, borderColor: category.color }]}
                  >
                    <CategoryBadge icon={category.icon} color={on ? category.color : colors.muted} size={18} />
                    <Text style={[styles.chipText, on && { color: colors.text }]}>{category.name}</Text>
                  </Pressable>
                )
              })}
              <Pressable accessibilityRole="button" accessibilityLabel="Criar nova categoria" onPress={() => setCatModal({ category: null })} style={[styles.chip, styles.chipNew]}>
                <MaterialCommunityIcons name="plus" size={18} color={colors.text} />
                <Text style={[styles.chipText, { color: colors.text }]}>Nova</Text>
              </Pressable>
            </View>
            {hasCustomCategory ? <Text style={styles.hint}>Segure uma categoria sua para editar ou apagar.</Text> : null}
          </>
        )}

        {/* Data */}
        <Text style={styles.label}>Data</Text>
        <View style={styles.chips}>
          <Chip label="Hoje" selected={date === today} onPress={() => chooseDate(today)} />
          <Chip label="Ontem" selected={date === yesterday} onPress={() => chooseDate(yesterday)} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Escolher outra data no calendário"
            onPress={() => {
              tap()
              setPickDate('date')
            }}
            style={[styles.dateButton, date !== today && date !== yesterday && styles.dateButtonOn]}
          >
            <MaterialCommunityIcons name="calendar-month-outline" size={20} color={colors.text} />
            <Text style={styles.dateButtonText}>{date !== today && date !== yesterday ? dateBr(date) : 'Outra data'}</Text>
          </Pressable>
        </View>

        {/* Descrição */}
        <Text style={styles.label}>Descrição (opcional)</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={selected?.name ?? 'Ex.: Almoço com a equipe'}
          placeholderTextColor={colors.faint}
          maxLength={200}
          returnKeyType="done"
          style={styles.input}
        />

        {/* Gasto fixo: repete sozinho */}
        {isGeneratedOccurrence ? (
          <View style={styles.noticeRow}>
            <MaterialCommunityIcons name="repeat" size={16} color={colors.faint} />
            <Text style={styles.notice}>Lançada automaticamente por uma repetição. Para mudar a repetição, edite a transação original.</Text>
          </View>
        ) : (
          <View style={styles.repeatCard}>
            <View style={styles.repeatHead}>
              <MaterialCommunityIcons name="repeat" size={24} color={repeating ? colors.text : colors.muted} />
              <View style={styles.repeatTitles}>
                <Text style={styles.repeatTitle}>Gasto fixo (repetir)</Text>
                <Text style={styles.repeatSub}>Assinatura, conta, aluguel… lança sozinho</Text>
              </View>
              <Switch value={repeating} onValueChange={toggleRepeat} trackColor={{ true: colors.income, false: colors.cardHigh }} thumbColor="#fff" accessibilityLabel="Gasto fixo, repetir" />
            </View>

            {repeating ? (
              <View style={styles.repeatBody}>
                <Text style={styles.subLabel}>Repete</Text>
                <View style={styles.chips}>
                  <Chip label="Todo mês" selected={recurrence === 'monthly'} onPress={() => setRecurrence('monthly')} />
                  <Chip label="Todo ano" selected={recurrence === 'yearly'} onPress={() => setRecurrence('yearly')} />
                </View>
                <Text style={styles.subLabel}>Até quando</Text>
                <View style={styles.chips}>
                  <Chip label="Sem fim" selected={until === null} onPress={() => setUntil(null)} />
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Escolher até quando no calendário"
                    onPress={() => {
                      tap()
                      setPickDate('until')
                    }}
                    style={[styles.dateButton, until !== null && styles.dateButtonOn]}
                  >
                    <MaterialCommunityIcons name="calendar-month-outline" size={20} color={colors.text} />
                    <Text style={styles.dateButtonText}>{until ? dateBr(until) : 'Escolher data'}</Text>
                  </Pressable>
                </View>
                <Text style={styles.hint}>{repeatHint}</Text>
              </View>
            ) : null}
          </View>
        )}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={() => void save()}
          disabled={!canSave}
          accessibilityRole="button"
          style={({ pressed }) => [styles.save, !canSave && styles.saveOff, pressed && canSave && styles.savePressed]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.saveText}>
              {amount <= 0 ? 'Digite o valor' : !selected ? 'Escolha o motivo' : transaction ? `Salvar alterações · ${brl(amount)}` : `Salvar ${label.toLowerCase()} · ${brl(amount)}`}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      <DateSheet mode="single" visible={pickDate === 'date'} title="Data da transação" value={date} onPick={chooseDate} onClose={() => setPickDate(null)} />
      <DateSheet mode="single" visible={pickDate === 'until'} title="Repetir até" value={until} minDate={date} onPick={setUntil} onClose={() => setPickDate(null)} />
      <CategoryFormModal visible={catModal !== null} type={type} category={catModal?.category ?? null} onClose={() => setCatModal(null)} onSaved={onCategorySaved} onDeleted={onCategoryDeleted} />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  screen: { flexGrow: 1, paddingHorizontal: 16, gap: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleItem: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  toggleText: { color: colors.muted, fontSize: 17, fontWeight: '700' },
  amountCard: { backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 },
  amountLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currency: { fontSize: 28, fontWeight: '700' },
  amountInput: { flex: 1, height: 64, fontSize: 40, fontWeight: '700', fontVariant: ['tabular-nums'], padding: 0 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12 },
  subLabel: { color: colors.faint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  chipNew: { borderStyle: 'dashed', borderColor: colors.faint },
  chipText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  hint: { color: colors.faint, fontSize: 13, lineHeight: 18 },
  loading: { height: 60 },
  retry: { padding: 12, borderRadius: radius.md, backgroundColor: colors.card },
  retryText: { color: colors.expense, fontSize: 14 },
  retryAction: { color: colors.muted, fontSize: 13, marginTop: 4 },
  dateButton: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 42, borderRadius: 21, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  dateButtonOn: { borderColor: colors.text, backgroundColor: `${colors.text}22` },
  dateButtonText: { color: colors.text, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] },
  input: { height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, fontSize: 16, paddingHorizontal: 14 },
  repeatCard: { marginTop: 12, backgroundColor: colors.card, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 },
  repeatHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  repeatTitles: { flex: 1 },
  repeatTitle: { color: colors.text, fontSize: 16, fontWeight: '600' },
  repeatSub: { color: colors.faint, fontSize: 13, marginTop: 1 },
  repeatBody: { gap: 8, marginTop: 6 },
  noticeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  notice: { flex: 1, color: colors.faint, fontSize: 13, lineHeight: 18 },
  error: { color: colors.expense, fontSize: 14, textAlign: 'center', marginTop: 8 },
  save: { height: 60, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  saveOff: { opacity: 0.35 },
  savePressed: { opacity: 0.85 },
  saveText: { color: colors.onPrimary, fontSize: 18, fontWeight: '700' },
})
