import { useState } from 'react'
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createCard, errorMessage } from '../api'
import { colors, radius } from '../theme'
import type { FinanceCard } from '../types'

export function CardFormModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: (card: FinanceCard) => void }) {
  const insets = useSafeAreaInsets()
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}><View style={styles.backdrop}><View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) }]}>{visible && <CardForm onClose={onClose} onSaved={onSaved} />}</View></View></Modal>
}
function CardForm({ onClose, onSaved }: { onClose: () => void; onSaved: (card: FinanceCard) => void }) {
  const [name, setName] = useState('')
  const [lastFour, setLastFour] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    if (busy) return
    if (!name.trim() || (lastFour && !/^[0-9]{4}$/.test(lastFour))) { setError('Informe um nome e, opcionalmente, os últimos quatro dígitos.'); return }
    setBusy(true); setError('')
    try { const card = await createCard(name.trim(), lastFour); onSaved(card); onClose() }
    catch (err) { setError(errorMessage(err)); setBusy(false) }
  }
  return <>
    <Text style={styles.title}>Adicionar cartão</Text>
    <Text style={styles.hint}>Um nome para organizar seus registros. Não é uma conexão com o banco.</Text>
    <TextInput accessibilityLabel="Nome do cartão" value={name} onChangeText={setName} maxLength={60} placeholder="Ex.: Nubank, Banco Inter ou Meu vale" placeholderTextColor={colors.faint} style={styles.input} />
    <TextInput accessibilityLabel="Últimos quatro dígitos" value={lastFour} onChangeText={(value) => setLastFour(value.replace(/\D/g, '').slice(0, 4))} maxLength={4} keyboardType="number-pad" placeholder="Últimos 4 dígitos (opcional)" placeholderTextColor={colors.faint} style={styles.input} />
    {error ? <Text style={{ color: colors.expense }} accessibilityRole="alert">{error}</Text> : null}
    <Pressable onPress={() => void save()} disabled={busy} style={styles.button} accessibilityRole="button">{busy ? <ActivityIndicator /> : <Text style={styles.buttonText}>Salvar cartão</Text>}</Pressable>
    <Pressable onPress={onClose} disabled={busy} style={styles.cancel} accessibilityRole="button"><Text style={styles.hint}>Cancelar</Text></Pressable>
  </>
}
const styles = StyleSheet.create({ backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }, sheet: { backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, gap: 16 }, title: { color: colors.text, fontSize: 22, fontWeight: '700' }, hint: { color: colors.muted, fontSize: 14, lineHeight: 20 }, input: { color: colors.text, backgroundColor: colors.bg, padding: 14, borderRadius: radius.md, minHeight: 50, fontSize: 16 }, button: { backgroundColor: colors.primary, minHeight: 50, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' }, buttonText: { color: colors.onPrimary, fontWeight: '700', fontSize: 16 }, cancel: { alignItems: 'center', padding: 12 } })
