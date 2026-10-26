import { MaterialCommunityIcons } from '@expo/vector-icons'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import { useEffect, useState } from 'react'
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage } from '../services/api'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { FinancialProfile, ProfileInput } from '../@types/api'

const QUESTIONS = ['Como podemos chamar você?', 'Em que dia você recebe?', 'Quando costuma pagar as contas?', 'Quando começa seu novo ciclo?', 'Quer adicionar um cartão?', 'Tudo pronto para começar?']
export function OnboardingScreen({ name, initial, onSave, onCancel, remindersEnabled = true }: { remindersEnabled?: boolean; name: string; initial?: FinancialProfile; onSave: (value: ProfileInput, reminders: boolean) => Promise<void>; onCancel: () => void }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const insets = useSafeAreaInsets()
  const { fontScale } = useWindowDimensions()
  const daySize = Math.max(44, Math.ceil(36 * fontScale))
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<FinancialProfile>(initial ?? { name, photo: null, salary_day: 5, bills_day: 10, cycle_day: 5 })
  const [sameDay, setSameDay] = useState(!initial || initial.cycle_day === initial.salary_day)
  const [cardName, setCardName] = useState('')
  const [lastFour, setLastFour] = useState('')
  const [reminders, setReminders] = useState(remindersEnabled)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const listener = BackHandler.addEventListener('hardwareBackPress', () => { if (!busy) { if (step > 0) setStep(step - 1); else onCancel() }; return true })
    return () => listener.remove()
  }, [step, busy, onCancel])
  async function choosePhoto() {
    setError('')
    try {
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.7 })
      if (result.canceled) return
      const context = ImageManipulator.manipulate(result.assets[0].uri)
      context.resize({ width: 256 })
      const image = await context.renderAsync()
      const photo = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true })
      if (!photo.base64 || photo.base64.length > 330000) throw new Error('Escolha uma foto menor.')
      setProfile((current) => ({ ...current, photo: 'data:image/jpeg;base64,' + photo.base64 }))
    } catch (err) { setError(errorMessage(err)) }
  }
  async function next() {
    if (busy) return
    setError('')
    if (!profile.name.trim()) { setStep(0); setError('Digite seu nome.'); return }
    if (step === 4 && (cardName.trim() || lastFour) && (!cardName.trim() || (lastFour && !/^[0-9]{4}$/.test(lastFour)))) { setError('Informe o nome do cartão e, se quiser, os quatro últimos dígitos.'); return }
    if (step < 5) { setStep(step + 1); return }
    setBusy(true)
    try {
      await onSave({ ...profile, name: profile.name.trim(), cycle_day: sameDay ? profile.salary_day : profile.cycle_day, ...(cardName.trim() ? { card: { name: cardName.trim(), last_four: lastFour } } : {}) }, reminders)
    } catch (err) { setError(errorMessage(err)); setBusy(false) }
  }
  const dayField = step === 1 ? 'salary_day' : step === 2 ? 'bills_day' : 'cycle_day'
  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
      <View style={styles.row}>
        <Pressable disabled={busy} accessibilityRole="button" accessibilityLabel="Voltar" style={styles.iconButton} onPress={() => { setError(''); step ? setStep(step - 1) : onCancel() }}><MaterialCommunityIcons name="arrow-left" size={22} color={colors.text} /></Pressable>
        <Text style={[styles.muted, styles.stepLabel]}>{`Seu perfil · ${step + 1} de ${QUESTIONS.length}`}</Text>
      </View>
      <View style={styles.progress}>{QUESTIONS.map((_, index) => <View key={index} style={[styles.segment, index <= step && { backgroundColor: colors.income }]} />)}</View>
      <Text style={styles.title}>{QUESTIONS[step]}</Text>
      {step === 0 && <>
        <Text style={styles.muted}>Vamos deixar o app com a sua cara. A foto é opcional.</Text>
        <Pressable onPress={() => void choosePhoto()} accessibilityRole="button" accessibilityLabel="Escolher foto de perfil" style={styles.avatar}>{profile.photo ? <Image source={{ uri: profile.photo }} style={styles.photo} /> : <MaterialCommunityIcons name="camera-plus-outline" size={28} color={colors.muted} />}</Pressable>
        {profile.photo && <Pressable onPress={() => setProfile({ ...profile, photo: null })}><Text style={styles.link}>Remover foto</Text></Pressable>}
        <TextInput accessibilityLabel="Seu nome" placeholder="Como você gosta de ser chamado?" placeholderTextColor={colors.faint} value={profile.name} onChangeText={(name) => setProfile({ ...profile, name })} maxLength={100} autoCapitalize="words" style={styles.input} />
      </>}
      {step >= 1 && step <= 3 && <>
        <Text style={styles.muted}>{step === 1 ? 'Escolha o dia do mês em que seu salário costuma chegar.' : step === 2 ? 'Vamos lembrar você de conferir os pagamentos nesse dia.' : 'Receitas e despesas começam um novo período. O saldo, as dívidas e o histórico continuam guardados.'}</Text>
        {step === 3 && <View style={styles.row}><Text style={[styles.text, { flex: 1 }]}>No dia em que recebo ({profile.salary_day})</Text><Switch value={sameDay} onValueChange={setSameDay} accessibilityLabel="Iniciar ciclo no dia do recebimento" /></View>}
        {(step !== 3 || !sameDay) && <View style={styles.days}>{Array.from({ length: 31 }, (_, i) => i + 1).map((day) => <Pressable key={day} accessibilityRole="radio" accessibilityState={{ checked: profile[dayField] === day }} accessibilityLabel={'Dia ' + day} onPress={() => setProfile({ ...profile, [dayField]: day })} style={[styles.day, { width: daySize, minHeight: daySize, borderRadius: daySize / 2 }, profile[dayField] === day && styles.selected]}><Text style={[styles.dayText, profile[dayField] === day && { color: colors.onPrimary }]}>{String(day)}</Text></Pressable>)}</View>}
        <Text style={styles.muted}>Nos meses mais curtos, usamos o último dia do mês.</Text>
      </>}
      {step === 4 && <>
        <Text style={styles.muted}>Opcional. Cadastre um nome para organizar entradas e saídas. Você pode adicionar outros cartões na sua conta.</Text>
        <MaterialCommunityIcons name="credit-card-outline" size={36} color={colors.income} />
        <TextInput accessibilityLabel="Nome do cartão" placeholder="Ex.: Meu Nubank" placeholderTextColor={colors.faint} value={cardName} onChangeText={setCardName} maxLength={60} style={styles.input} />
        <TextInput accessibilityLabel="Últimos quatro dígitos" placeholder="Últimos 4 dígitos (opcional)" placeholderTextColor={colors.faint} value={lastFour} onChangeText={(text) => setLastFour(text.replace(/\D/g, '').slice(0, 4))} keyboardType="number-pad" maxLength={4} style={styles.input} />
        <Text style={styles.muted}>Só para controle pessoal. Não precisamos do número completo, senha ou código de segurança.</Text>
        <Pressable onPress={() => { setCardName(''); setLastFour(''); setError(''); setStep(5) }}><Text style={styles.link}>Pular por enquanto</Text></Pressable>
      </>}
      {step === 5 && <>
        <View style={styles.summary}><Text style={styles.name}>{profile.name}</Text><Text style={styles.text}>Recebimento: dia {profile.salary_day}</Text><Text style={styles.text}>Contas: dia {profile.bills_day}</Text><Text style={styles.text}>Novo ciclo: dia {sameDay ? profile.salary_day : profile.cycle_day}</Text><Text style={styles.text}>{cardName || 'Sem cartão por enquanto'}</Text></View>
        <View style={styles.row}><Text style={[styles.text, { flex: 1 }]}>Avisos de recebimento, contas e novo ciclo</Text><Switch value={reminders} onValueChange={setReminders} accessibilityLabel="Ativar lembretes" /></View>
        <Text style={styles.muted}>Você pode editar seu perfil depois, na aba Conta.</Text>
      </>}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      <Pressable disabled={busy} onPress={() => void next()} accessibilityRole="button" style={[styles.button, busy && { opacity: 0.5 }]}><Text style={styles.buttonText}>{busy ? 'Salvando…' : step === 5 ? 'Concluir perfil' : 'Continuar'}</Text></Pressable>
    </ScrollView>
  )
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg }, content: { paddingHorizontal: 24, gap: 20, flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, iconButton: { width: 44, height: 44, justifyContent: 'center' },
  progress: { flexDirection: 'row', gap: 5 }, segment: { height: 4, borderRadius: 2, backgroundColor: colors.cardHigh, flex: 1 },
  title: { fontSize: 28, fontWeight: '700', color: colors.text, marginTop: 16 }, text: { fontSize: 16, color: colors.text, lineHeight: 24 }, muted: { fontSize: 14, color: colors.muted, lineHeight: 22 },
  input: { minHeight: 54, borderRadius: radius.md, backgroundColor: colors.card, padding: 16, color: colors.text, fontSize: 16 },
  avatar: { height: 88, width: 88, borderRadius: 44, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' }, photo: { height: 88, width: 88, borderRadius: 44 },
  days: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 }, day: { flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: colors.card }, selected: { backgroundColor: colors.primary },
  dayText: { width: '100%', textAlign: 'center', fontSize: 16, color: colors.text, fontVariant: ['tabular-nums'], paddingVertical: 8 },
  stepLabel: { flex: 1 },
  summary: { backgroundColor: colors.card, borderRadius: radius.lg, padding: 20, gap: 12 }, name: { color: colors.text, fontSize: 22, fontWeight: '700' }, link: { color: colors.income, fontSize: 15, paddingVertical: 8 }, error: { color: colors.expense, lineHeight: 22 },
  button: { marginTop: 'auto', minHeight: 52, backgroundColor: colors.primary, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', padding: 14 }, buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 },
})
