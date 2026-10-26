import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useEffect, useState } from 'react'
import { Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { TransactionCategory } from '../@types/api'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import { useAuth } from '../hooks/useAuth'
import { errorMessage, getCategories } from '../services/api'
import { parseBankNotification } from '../services/bankNotification'
import { TASKER_SCRIPT } from '../config/taskerScript'

export function BankAutomationScreen({ onClose }: { onClose: () => void }) {
  const { colors } = useTheme(); const styles = createStyles(colors); const insets = useSafeAreaInsets()
  const { server } = useAuth()
  const [bank, setBank] = useState('Nubank'); const [text, setText] = useState(''); const [message, setMessage] = useState('')
  const [categories, setCategories] = useState<TransactionCategory[]>([])
  const [showScript, setShowScript] = useState(false)
  useEffect(() => { getCategories().then(setCategories).catch(error => setMessage(errorMessage(error))) }, [])
  function test() {
    try {
      const now = new Date(); const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      const row = parseBankNotification(bank, text, date)
      setMessage(`${row.type === 'income' ? 'Receita' : 'Despesa'} de R$ ${(row.cents / 100).toFixed(2).replace('.', ',')} em ${row.date.split('-').reverse().join('/')}. Nenhum lançamento foi salvo.`)
    } catch (error) { setMessage(errorMessage(error)) }
  }
  return <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20, gap: 16 }} keyboardShouldPersistTaps="handled">
    <View style={styles.row}><Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Voltar" style={styles.back}><MaterialCommunityIcons name="arrow-left" size={24} color={colors.text} /></Pressable><Text style={styles.title}>Bancos e automações</Text></View>
    <Text style={styles.note}>No Android, o Tasker pode capturar as notificações da CAIXA e do Nubank e criar lançamentos na sua conta, mesmo com este app fechado. É preciso configurar o Tasker no celular; esta tela não ativa a leitura de notificações.</Text>
    <View style={styles.card}><Text style={styles.label}>Teste uma notificação</Text><View style={styles.row}>{['Nubank', 'CAIXA'].map(b => <Pressable key={b} onPress={() => setBank(b)} accessibilityRole="button" accessibilityState={{ selected: bank === b }} style={[styles.chip, bank === b && { borderColor: colors.primary, backgroundColor: colors.primarySoft }]}><Text style={styles.text}>{b}</Text></Pressable>)}</View>
      <TextInput value={text} onChangeText={setText} multiline maxLength={2000} accessibilityLabel="Texto da notificação bancária" placeholder="Cole o título e o texto de uma notificação de compra ou Pix" placeholderTextColor={colors.faint} style={styles.input} />
      <Pressable onPress={test} accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>Testar leitura, sem salvar</Text></Pressable>
      {!!message && <Text accessibilityRole="alert" style={styles.text}>{message}</Text>}
      <Text style={styles.note}>Aceita mensagens com compra confirmada, Pix recebido ou enviado e um único valor R$ 123,45. Avisos ambíguos são recusados. Sem data explícita, usa o dia da captura. Teste textos reais antes de automatizar.</Text>
    </View>
    <View style={styles.card}><Text style={styles.label}>Configurar no Tasker</Text>
      <Text style={styles.text}>1. Crie um perfil Evento → UI → Notification, escolhendo somente o aplicativo oficial do banco. Ative New Only e libere o acesso às notificações. Para SMS, use um perfil separado com remetente verificado; não processe todas as mensagens.</Text>
      <Text style={styles.text}>2. Na tarefa, configure %bank (CAIXA ou Nubank), %text (título + texto do evento), %expense_category e %income_category com os IDs abaixo. Configure colisões da tarefa como Abort New Task, para evitar envios paralelos.</Text>
      <Text style={styles.text}>3. Adicione uma ação JavaScript com o script abaixo e Auto Exit ligado. Comece com %mode = preview e confira %lokos_preview. Quando os testes estiverem corretos, use %mode = send.</Text>
      <Text style={styles.text}>4. Faça login pelo HTTP Request POST no endereço abaixo, usando JSON com seu e-mail e senha. Gere o corpo com JSON.stringify para escapar aspas. Leia access_token da resposta e guarde em %LokosToken. Apague a senha da tarefa depois do login; repita o login quando receber 401.</Text>
      <Text selectable style={styles.code}>{server}/auth/login</Text>
      <Text style={styles.text}>5. Apenas se %lokos_body estiver preenchido, limpe %http_response_code e %http_data anteriores e execute HTTP Request POST com o corpo %lokos_body e estes cabeçalhos. Nunca repita automaticamente após timeout.</Text>
      <Text selectable style={styles.code}>{server}/finance/transactions{'\n'}Content-Type: application/json{'\n'}Authorization: Bearer %LokosToken</Text>
      <Text style={styles.text}>6. Após o HTTP, configure %mode = confirm e rode o mesmo script, inclusive quando houver erro (Continue Task After Error). O histórico fica em %LokosHistory. Falhas ficam pendentes para revisão no extrato.</Text>
      <Text style={styles.note}>O token dá acesso à sua conta. Não compartilhe tarefas exportadas com tokens. Mensagens idênticas do mesmo banco no mesmo dia são bloqueadas: se forem compras distintas, lance a segunda manualmente. O histórico local não garante deduplicação entre aparelhos ou contra importações de extratos.</Text>
      <Text style={styles.label}>IDs das suas categorias</Text>{categories.map(c => <Text selectable key={c.id} style={styles.text}>{c.name} · {c.type === 'income' ? 'receita' : 'despesa'} · ID {c.id}</Text>)}
      <Pressable onPress={() => setShowScript(!showScript)} accessibilityRole="button" style={styles.button}><Text style={styles.buttonText}>{showScript ? 'Ocultar script' : 'Mostrar script Tasker'}</Text></Pressable>
      {showScript && <TextInput accessibilityLabel="Script Tasker" multiline editable={false} value={TASKER_SCRIPT} style={[styles.input, styles.code, { minHeight: 280 }]} />}
      <Pressable onPress={() => void Linking.openURL('https://tasker.joaoapps.com/userguide/en/help/ah_http_request.html')} accessibilityRole="link" style={styles.chip}><Text style={styles.text}>Documentação do Tasker ↗</Text></Pressable>
    </View>
    <Text style={styles.note}>No iOS não há acesso às notificações de outros aplicativos por este fluxo. Use a importação OFX/CSV. O servidor precisa estar disponível para salvar os lançamentos.</Text>
  </ScrollView>
}
const createStyles = (c: ThemeColors) => StyleSheet.create({ screen: { flex: 1, backgroundColor: c.bg }, row: { flexDirection: 'row', alignItems: 'center', gap: 10 }, back: { minHeight: 44, minWidth: 44, justifyContent: 'center' }, title: { flex: 1, fontSize: 24, color: c.text, fontWeight: '700' }, text: { color: c.text, fontSize: 14, lineHeight: 22 }, note: { color: c.muted, fontSize: 13, lineHeight: 21 }, label: { color: c.text, fontWeight: '700', fontSize: 17 }, card: { padding: 18, borderRadius: 24, gap: 14, backgroundColor: c.card, borderWidth: 1, borderColor: c.border }, chip: { minHeight: 44, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: c.border }, input: { minHeight: 120, color: c.text, backgroundColor: c.bg, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: c.border, textAlignVertical: 'top', fontSize: 14 }, button: { minHeight: 52, backgroundColor: c.primary, borderRadius: 16, alignItems: 'center', justifyContent: 'center', padding: 12 }, buttonText: { color: c.onPrimary, fontWeight: '700', fontSize: 15 }, code: { color: c.text, fontSize: 12, lineHeight: 19, fontFamily: 'monospace' } })
