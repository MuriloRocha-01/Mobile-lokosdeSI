import { confirmAction } from '../confirm'
import { installmentPreview } from '../installments'
import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { dateBr, parseAmountText } from '../calendarUtils'
import { createInstallments, createTransaction, errorMessage, getCategories, getCards, updateTransaction } from '../api'
import { CardFormModal } from '../components/CardFormModal'
import { PAYMENT_METHODS, cardLabel, paymentLabel, requiresCard } from '../payment'
import { CategoryBadge } from '../components/CategoryBadge'
import { CategoryFormModal } from '../components/CategoryFormModal'
import { Chip } from '../components/Chip'
import { DateSheet } from '../components/DateSheet'
import { brl, todayIso, yesterdayIso } from '../format'
import { success, tap, warning } from '../haptics'
import * as storage from '../storage'
import { colors, radius } from '../theme'
import type { FinanceCard, PaymentMethod, Transaction, TransactionCategory, TransactionRecurrence, TransactionType } from '../types'

const lastCategoryKey = (type: TransactionType) => `ecossistema.lastCategory.${type}`

interface Props {
  /** A transação sendo editada; ausente/null = lançamento novo. */
  initialRecurrence?: TransactionRecurrence
  initialType?: TransactionType
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
export function NewTransactionScreen({ transaction = null, initialType = 'expense', initialRecurrence = 'none', onClose, onSaved }: Props) {
  const insets = useSafeAreaInsets()
  // Ocorrência lançada automaticamente por uma repetição: a repetição só se mexe na transação original (backend).
  const isGeneratedOccurrence = transaction?.recurrence_parent_id != null
  const isInstallment = transaction?.installment_number != null
  const [paymentStatus, setPaymentStatus] = useState<'pending' | 'settled'>(transaction?.status ?? 'settled')
  const [type, setType] = useState<TransactionType>(transaction?.type ?? initialType)
  const [amountText, setAmountText] = useState(transaction ? transaction.amount.toFixed(2).replace('.', ',') : '')
  const [categories, setCategories] = useState<TransactionCategory[] | null>(null)
  const [loadError, setLoadError] = useState('')
  const [chosen, setChosen] = useState<Partial<Record<TransactionType, number>>>(transaction ? { [transaction.type]: transaction.category_id } : {})
  const [remembered, setRemembered] = useState<Partial<Record<TransactionType, number>>>({})
  const [time, setTime] = useState(transaction ? transaction.time ?? '' : new Date().toTimeString().slice(0, 5))
  const [date, setDate] = useState(transaction?.date ?? todayIso())
  const [description, setDescription] = useState(transaction?.description ?? '')
  const [recurrence, setRecurrence] = useState<TransactionRecurrence>(transaction?.recurrence ?? initialRecurrence)
  const [until, setUntil] = useState<string | null>(transaction?.recurrence_until ?? null)
  const [pickDate, setPickDate] = useState<'date' | 'until' | null>(null)
  const [catModal, setCatModal] = useState<{ category: TransactionCategory | null } | null>(null)
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false)
  const [method, setMethod] = useState<PaymentMethod | null>(transaction ? transaction.payment_method : 'cash')
  const [cardId, setCardId] = useState<number | null>(transaction?.card_id ?? null)
  const [cards, setCards] = useState<FinanceCard[]>([])
  const [paymentOpen, setPaymentOpen] = useState(false)
  const [cardForm, setCardForm] = useState(false)
  const [cardError, setCardError] = useState('')
  const loadCards = useCallback(async () => { setCardError(''); try { setCards(await getCards(todayIso())) } catch (err) { setCardError(errorMessage(err)) } }, [])
  useEffect(() => { void loadCards() }, [loadCards])
  const [parcelled, setParcelled] = useState(false)
  const [countText, setCountText] = useState('12')
  const [withInterest, setWithInterest] = useState(false)
  const [paymentText, setPaymentText] = useState('')
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
  const installmentPlan = installmentPreview(amount, countText, paymentText, withInterest)
  const useInstallments = !transaction && type === 'expense' && parcelled
  const canSave = (!useInstallments || installmentPlan !== null) && amount > 0 && selected !== null && (!requiresCard(method) || cardId !== null) && (!time || /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time)) && !saving
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
    if (!transaction && iso > todayIso()) setPaymentStatus('pending')
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

  const savingRef = useRef(false)
  function confirmSave() {
    if (!selected || !canSave || savingRef.current) return
    const summary = [
      description.trim() || selected.name,
      useInstallments && installmentPlan ? `${installmentPlan.count} parcelas · total ${brl(installmentPlan.total)}` : brl(amount),
      `Data: ${dateBr(date)}${time ? ' · ' + time : ''}`,
      paymentLabel(method),
      method !== 'cash' && cards.find(card => card.id === cardId) ? cardLabel(cards.find(card => card.id === cardId)!) : '',
      useInstallments || paymentStatus === 'pending' ? 'Situação: pendente' : type === 'income' ? 'Situação: recebida' : 'Situação: paga',
      !useInstallments && repeating ? repeatHint : '',
    ].filter(Boolean).join('\n')
    confirmAction(transaction ? 'Confirmar alterações?' : type === 'expense' ? 'Cadastrar despesa?' : 'Cadastrar recebimento?', summary, 'Confirmar', () => { void save() })
  }

  async function save() {
    if (!selected || !canSave || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError('')
    const fields = {
      status: useInstallments ? 'pending' as const : paymentStatus,
      description: description.trim(), // vazio: o servidor usa o nome da categoria
      amount,
      date,
      time: time || null,
      type,
      category_id: selected.id,
      payment_method: method,
      card_id: method === 'cash' || !method ? null : cardId,
      ...(isGeneratedOccurrence || isInstallment ? {} : { recurrence, recurrence_until: repeating ? until : null }),
    }
    try {
      if (transaction) await updateTransaction(transaction.id, fields)
      else if (useInstallments && installmentPlan) await createInstallments({ ...fields, recurrence: 'none', recurrence_until: null, count: installmentPlan.count, ...(withInterest ? { installment_amount: installmentPlan.payment } : {}) })
      else await createTransaction(fields)
      void storage.setItem(lastCategoryKey(type), String(selected.id))
      success()
      onSaved(useInstallments ? `${installmentPlan!.count} parcelas cadastradas · ${brl(installmentPlan!.total)}` : transaction ? `${label} atualizada` : `${label} de ${brl(amount)} salva em ${selected.name}`)
    } catch (err) {
      warning()
      setError(errorMessage(err))
      setSaving(false)
      savingRef.current = false
    }
  }

  const repeatHint = repeating
    ? `Cria pendências ${recurrence === 'monthly' ? `todo dia ${Number(date.slice(8))} do mês` : `todo dia ${date.slice(8)}/${date.slice(5, 7)} do ano`}${until ? ` até ${dateBr(until)}` : ', sem data para acabar'}.`
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
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" hitSlop={12} style={styles.close}>
            <MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} />
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
                disabled={isInstallment && option === 'income'}
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
          {selected ? <View style={styles.amountIcon}><CategoryBadge icon={selected.icon} color={selected.color} size={20} /></View> : null}
          <Text style={styles.amountLabel}>{useInstallments ? 'Valor da compra à vista' : 'Valor'}</Text>
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
        <Pressable onPress={() => setCategoryPickerOpen(true)} accessibilityRole="button" accessibilityLabel="Alterar motivo" style={styles.categoryField}>
          {selected ? <CategoryBadge icon={selected.icon} color={selected.color} size={18} /> : <MaterialCommunityIcons name="tag-outline" size={18} color={colors.muted} />}
          <Text style={styles.categoryName}>{selected?.name ?? 'Escolher motivo'}</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
        </Pressable>

        <Text style={styles.label}>Forma de pagamento</Text>
        <Pressable onPress={() => setPaymentOpen(true)} accessibilityRole="button" accessibilityLabel="Escolher forma de pagamento e cartão" style={styles.categoryField}>
          <MaterialCommunityIcons name="credit-card-outline" size={18} color={colors.muted} />
          <Text style={styles.categoryName}>{paymentLabel(method)}{cardId !== null ? '\n' + (cards.find((card) => card.id === cardId)?.name ?? transaction?.card?.name ?? 'Cartão selecionado') : ''}</Text>
          <MaterialCommunityIcons name="chevron-right" size={18} color={colors.muted} />
        </Pressable>
        {requiresCard(method) && cardId === null && <Text style={styles.hint}>Selecione um cartão para continuar.</Text>}
        {/* Data */}
        <Text style={styles.label}>Data</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={'Escolher data: ' + dateBr(date)} onPress={() => { tap(); setPickDate('date') }} style={styles.categoryField}>
          <MaterialCommunityIcons name="calendar-month-outline" size={20} color={colors.muted} />
          <Text style={styles.categoryName}>{dateBr(date)}{date === today ? ' · Hoje' : date === yesterday ? ' · Ontem' : ''}</Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color={colors.muted} />
        </Pressable>

        <Text style={styles.label}>Horário (opcional)</Text>
        <TextInput accessibilityLabel="Horário da transação" value={time} onChangeText={setTime} placeholder="HH:MM" maxLength={5} keyboardType="numbers-and-punctuation" placeholderTextColor={colors.faint} style={styles.input} />
        {time && !/^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/.test(time) ? <Text style={styles.error}>Use um horário válido, como 14:30.</Text> : null}
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

        {!transaction && type === 'expense' && <View style={styles.repeatCard}>
          <View style={styles.repeatHead}><View style={styles.repeatTitles}><Text style={styles.repeatTitle}>Compra parcelada</Text><Text style={styles.repeatSub}>Dividir em parcelas mensais</Text></View><Switch accessibilityLabel="Compra parcelada" value={parcelled} onValueChange={value => { setParcelled(value); if (value) { setRecurrence('none'); setUntil(null) } }} /></View>
          {useInstallments && <View style={styles.repeatBody}>
            <Text style={styles.label}>Quantidade de parcelas (2 a 120)</Text><TextInput accessibilityLabel="Quantidade de parcelas" value={countText} onChangeText={setCountText} keyboardType="number-pad" maxLength={3} style={styles.input} />
            <Text style={styles.hint}>A data escolhida acima será a primeira parcela. As outras ficam nos meses seguintes. No crédito, o vencimento segue a configuração da fatura.</Text>
            <View style={styles.repeatHead}><Text style={styles.repeatTitle}>Com juros / acréscimo</Text><Switch accessibilityLabel="Parcelas com juros" value={withInterest} onValueChange={setWithInterest} /></View>
            {withInterest && <><Text style={styles.label}>Valor cobrado por parcela (R$)</Text><TextInput accessibilityLabel="Valor cobrado por parcela" value={paymentText} onChangeText={setPaymentText} keyboardType="decimal-pad" maxLength={12} style={styles.input} /><Text style={styles.hint}>Informe o valor do comprovante, já com juros. Calculamos o total e o acréscimo sobre o preço à vista.</Text></>}
            {installmentPlan ? <Text style={styles.hint}>{installmentPlan.count} parcelas de {brl(installmentPlan.first)}{installmentPlan.first !== installmentPlan.last ? ' a ' + brl(installmentPlan.last) + ' (ajuste de centavos)' : ''}{'\n'}Total: {brl(installmentPlan.total)} · Acréscimo: {brl(installmentPlan.interest)}</Text> : <Text style={styles.error}>Confira a quantidade e os valores. O total das parcelas deve cobrir o valor da compra.</Text>}
          </View>}
        </View>}
        {!useInstallments && <View style={styles.repeatCard}>
          <Text style={styles.repeatTitle}>Situação deste lançamento</Text>
          <View style={styles.chips}><Chip label="Pendente" selected={paymentStatus === 'pending'} onPress={() => setPaymentStatus('pending')} /><Chip label={type === 'income' ? 'Já recebi' : 'Já paguei'} selected={paymentStatus === 'settled'} onPress={() => setPaymentStatus('settled')} /></View>
          <Text style={styles.hint}>{paymentStatus === 'pending' ? 'Entra na previsão. O saldo só muda quando você confirmar o pagamento ou recebimento.' : transaction?.status === 'pending' ? 'A baixa será registrada hoje.' : transaction ? 'Editar a data do lançamento mantém a data da baixa já registrada.' : 'Entra no saldo realizado. Em datas futuras, a baixa é registrada hoje.'}</Text>
        </View>}
        {/* Gasto fixo: repete sozinho */}
        {!useInstallments && (isInstallment ? <Text style={styles.hint}>Parcela {transaction?.installment_number}/{transaction?.installment_count}. As alterações afetam somente esta parcela.</Text> : isGeneratedOccurrence ? (
          <View style={styles.noticeRow}>
            <MaterialCommunityIcons name="repeat" size={16} color={colors.faint} />
            <Text style={styles.notice}>Lançada automaticamente por uma repetição. Para mudar a repetição, edite a transação original.</Text>
          </View>
        ) : (
          <View style={styles.repeatCard}>
            <View style={styles.repeatHead}>
              <MaterialCommunityIcons name="repeat" size={18} color={repeating ? colors.text : colors.muted} />
              <View style={styles.repeatTitles}>
                <Text style={styles.repeatTitle}>Gasto fixo (repetir)</Text>
                <Text style={styles.repeatSub}>Assinatura, academia, aluguel… cria pendências</Text>
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
        ))}

        {error ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error}
          </Text>
        ) : null}

        <Pressable
          onPress={confirmSave}
          disabled={!canSave}
          accessibilityRole="button"
          style={({ pressed }) => [styles.save, !canSave && styles.saveOff, pressed && canSave && styles.savePressed]}
        >
          {saving ? (
            <ActivityIndicator color={colors.onPrimary} />
          ) : (
            <Text style={styles.saveText}>
              {amount <= 0 ? 'Digite o valor' : !selected ? 'Escolha o motivo' : useInstallments ? `Salvar ${installmentPlan?.count ?? ''} parcelas` : transaction ? `Salvar alterações · ${brl(amount)}` : `Salvar ${label.toLowerCase()} · ${brl(amount)}`}
            </Text>
          )}
        </Pressable>
      </ScrollView>

      <Modal visible={paymentOpen} transparent animationType="slide" onRequestClose={() => setPaymentOpen(false)}>
        <View style={styles.backdrop}><View style={[styles.categorySheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.topBar}><Text style={styles.heading}>Pagamento e recebimento</Text><Pressable accessibilityRole="button" accessibilityLabel="Fechar pagamento" style={styles.close} onPress={() => setPaymentOpen(false)}><MaterialCommunityIcons name="close" size={20} color={colors.text} /></Pressable></View>
          <ScrollView contentContainerStyle={{ gap: 8, paddingVertical: 12 }}>
            {PAYMENT_METHODS.map((option) => <Chip key={option.id} label={option.label} selected={method === option.id} onPress={() => { setMethod(option.id); if (!transaction && option.id === 'credit_card') setPaymentStatus('pending'); if (option.id === 'cash') setCardId(null) }} />)}
            {method !== 'cash' && method !== null && <>
              <Text style={styles.label}>Cartão</Text>
              {method === 'pix' && <Chip label="Sem cartão" selected={cardId === null} onPress={() => setCardId(null)} />}
              {cards.map((card) => <Chip key={card.id} label={cardLabel(card)} selected={cardId === card.id} onPress={() => setCardId(card.id)} />)}
              {cardError ? <Pressable onPress={() => void loadCards()}><Text style={styles.error}>{cardError} · Tentar novamente</Text></Pressable> : null}
              <Pressable onPress={() => setCardForm(true)} accessibilityRole="button" style={styles.categoryField}><Text style={styles.categoryName}>+ Adicionar cartão</Text></Pressable>
            </>}
            {method === 'cash' && <Text style={styles.hint}>Dinheiro fica sem cartão associado.</Text>}
            <Pressable accessibilityRole="button" onPress={() => setPaymentOpen(false)} style={styles.save}><Text style={styles.saveText}>Concluir</Text></Pressable>
          </ScrollView>
          <CardFormModal visible={cardForm} onClose={() => setCardForm(false)} onSaved={(card) => { setCards((current) => [...current.filter((c) => c.id !== card.id), card]); setCardId(card.id) }} />
        </View></View>
      </Modal>
      <Modal visible={categoryPickerOpen} transparent animationType="slide" onRequestClose={() => setCategoryPickerOpen(false)}>
        <View style={styles.backdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setCategoryPickerOpen(false)} accessibilityLabel="Fechar motivos" />
          <View style={[styles.categorySheet, { paddingBottom: Math.max(insets.bottom, 16), marginTop: insets.top + 16 }]}>
            <View style={styles.topBar}>
              <Text style={styles.heading}>Escolher motivo</Text>
              <Pressable onPress={() => setCategoryPickerOpen(false)} accessibilityRole="button" accessibilityLabel="Fechar motivos" style={styles.close}><MaterialCommunityIcons name="close" size={20} color={colors.text} /></Pressable>
            </View>
            <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
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
                  <View style={styles.categoryList}>
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
                            setCategoryPickerOpen(false)
                          }}
                          onLongPress={category.is_default ? undefined : () => setCatModal({ category })}
                          delayLongPress={400}
                          style={[styles.categoryOption, on && { backgroundColor: `${category.color}2b`, borderColor: category.color }]}
                        >
                          <CategoryBadge icon={category.icon} color={on ? category.color : colors.muted} size={18} />
                          <Text style={[styles.chipText, on && { color: colors.text }]}>{category.name}</Text>
                        </Pressable>
                      )
                    })}
                    <Pressable accessibilityRole="button" accessibilityLabel="Criar nova categoria" onPress={() => setCatModal({ category: null })} style={[styles.categoryOption, styles.chipNew]}>
                      <MaterialCommunityIcons name="plus" size={18} color={colors.text} />
                      <Text style={[styles.chipText, { color: colors.text }]}>Nova</Text>
                    </Pressable>
                  </View>
                  {hasCustomCategory ? <Text style={styles.hint}>Segure uma categoria sua para editar ou apagar.</Text> : null}
                </>
              )}
            </ScrollView>
          </View>
          <CategoryFormModal visible={catModal !== null} type={type} category={catModal?.category ?? null} onClose={() => setCatModal(null)} onSaved={onCategorySaved} onDeleted={onCategoryDeleted} />
        </View>
      </Modal>
      <DateSheet mode="single" visible={pickDate === 'date'} title="Data da transação" value={date} onPick={chooseDate} onClose={() => setPickDate(null)} />
      <DateSheet mode="single" visible={pickDate === 'until'} title="Repetir até" value={until} minDate={date} onPick={setUntil} onClose={() => setPickDate(null)} />
    </View>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
  categorySheet: { maxHeight: '80%', padding: 20, backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  categoryList: { gap: 8 },
  categoryOption: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12 },
  categoryField: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54, padding: 16, borderRadius: radius.md, backgroundColor: colors.card },
  categoryName: { flex: 1, color: colors.text, fontSize: 16 },
  amountIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.cardHigh, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  screen: { flexGrow: 1, paddingHorizontal: 24, gap: 10 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  heading: { color: colors.text, fontSize: 18, fontWeight: '600' },
  toggle: { flexDirection: 'row', gap: 8 },
  toggleItem: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.card },
  toggleText: { color: colors.muted, fontSize: 15, fontWeight: '700' },
  amountCard: { paddingTop: 24, paddingBottom: 20 },
  amountLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  currency: { fontSize: 28, fontWeight: '700' },
  amountInput: { flex: 1, height: 64, fontSize: 34, fontWeight: '700', fontVariant: ['tabular-nums'], padding: 0 },
  label: { color: colors.muted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12 },
  subLabel: { color: colors.faint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
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
  save: { minHeight: 52, paddingVertical: 14, paddingHorizontal: 12, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  saveOff: { opacity: 0.35 },
  savePressed: { opacity: 0.85 },
  saveText: { color: colors.onPrimary, textAlign: 'center', fontSize: 16, fontWeight: '700' },
})
