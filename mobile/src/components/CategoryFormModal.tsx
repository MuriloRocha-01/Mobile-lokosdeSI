import { useState } from 'react'
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { createCategory, deleteCategory, errorMessage, updateCategory } from '../services/api'
import { cleanEmojiInput, isEmojiIcon } from '../utils/categoryIcons'
import { confirmDestructive } from '../utils/confirm'
import { success, tap, warning } from '../utils/haptics'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'
import type { TransactionCategory, TransactionType } from '../@types/api'
import { CategoryBadge } from './CategoryBadge'

const SUGGESTIONS = [
  '🍔', '🍕', '☕', '🛒', '🍺', '🥗',
  '🚗', '⛽', '🚌', '🏠', '💡', '📱',
  '💧', '🔥', '🎮', '🎬', '🎵', '✈️',
  '🏖️', '🛍️', '👕', '💊', '🏥', '🦷',
  '📚', '🎓', '🐶', '🐱', '🎁', '💼',
  '💰', '💳', '📈', '🧾', '🏋️', '🔧',
] // prettier-ignore

const PALETTE = ['#f87171', '#fb923c', '#fbbf24', '#4ade80', '#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6']

interface Props {
  visible: boolean
  /** Tipo da categoria NOVA (ao editar o tipo não muda). */
  type: TransactionType
  /** Categoria sendo editada; ausente/null = criar uma nova. */
  category?: TransactionCategory | null
  onClose: () => void
  onSaved: (category: TransactionCategory) => void
  onDeleted?: (id: number) => void
}

/** Criar/editar uma categoria ("motivo") com emoji, como no cadastro de grupos da Lounge do desktop. */
export function CategoryFormModal(props: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const insets = useSafeAreaInsets()
  return (
    <Modal visible={props.visible} transparent animationType="slide" statusBarTranslucent navigationBarTranslucent onRequestClose={props.onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessibilityLabel="Fechar" />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}>
          {/* O Modal só monta o conteúdo aberto: o formulário recomeça do zero (ou da categoria editada) a cada abertura. */}
          <Body {...props} />
        </View>
      </View>
    </Modal>
  )
}

function Body({ type, category = null, onClose, onSaved, onDeleted }: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const editing = category !== null
  const [name, setName] = useState(category?.name ?? '')
  // Categoria padrão antiga guarda uma chave ("food"), não um emoji: abre sem emoji escolhido e só troca o ícone se a pessoa escolher um.
  const [emoji, setEmoji] = useState(category ? (isEmojiIcon(category.icon) ? category.icon : '') : type === 'income' ? '💰' : '🛒')
  const [custom, setCustom] = useState('')
  const [color, setColor] = useState(category?.color ?? PALETTE[4])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const trimmed = name.trim()
  const canSave = trimmed.length > 0 && !busy && (editing || emoji !== '')
  const previewIcon = emoji || category?.icon || 'other'

  function onCustom(text: string) {
    const cleaned = cleanEmojiInput(text)
    if (cleaned === null) return // passou do limite: recusa em vez de cortar o emoji no meio
    setCustom(cleaned)
    if (cleaned) setEmoji(cleaned)
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError('')
    try {
      let saved: TransactionCategory
      if (category) {
        saved = await updateCategory(category.id, {
          ...(trimmed !== category.name ? { name: trimmed } : {}),
          ...(emoji && emoji !== category.icon ? { icon: emoji } : {}),
          ...(color !== category.color ? { color } : {}),
        })
      } else {
        saved = await createCategory({ name: trimmed, type, icon: emoji, color })
      }
      success()
      onSaved(saved)
      onClose()
    } catch (err) {
      warning()
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  function remove() {
    if (!category) return
    confirmDestructive('Apagar categoria?', `“${category.name}” — só dá certo se não houver transações nela.`, 'Apagar', () => {
      void (async () => {
        setBusy(true)
        setError('')
        try {
          await deleteCategory(category.id)
          success()
          onDeleted?.(category.id)
          onClose()
        } catch (err) {
          warning()
          setError(errorMessage(err))
          setBusy(false)
        }
      })()
    })
  }

  return (
    <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
      <Text style={styles.title}>{editing ? 'Editar categoria' : type === 'income' ? 'Nova categoria de receita' : 'Nova categoria de despesa'}</Text>

      <View style={styles.preview}>
        <View style={[styles.previewBox, { backgroundColor: `${color}33` }]}>
          <CategoryBadge icon={previewIcon} color={color} size={30} />
        </View>
        <Text style={styles.previewName} numberOfLines={1}>
          {trimmed || 'Nome da categoria'}
        </Text>
      </View>

      <Text style={styles.label}>Nome</Text>
      <TextInput value={name} onChangeText={setName} placeholder="Ex.: Lanche, Mercado, Aluguel" placeholderTextColor={colors.faint} maxLength={50} autoFocus={!editing} returnKeyType="done" style={styles.input} />

      <Text style={styles.label}>Emoji</Text>
      <View style={styles.grid}>
        {SUGGESTIONS.map((option) => {
          const on = emoji === option
          return (
            <Pressable
              key={option}
              onPress={() => {
                tap()
                setEmoji(option)
                setCustom('')
              }}
              accessibilityRole="button"
              accessibilityLabel={`Emoji ${option}`}
              accessibilityState={{ selected: on }}
              style={[styles.emojiCell, on && styles.emojiCellOn]}
            >
              <Text allowFontScaling={false} style={styles.emojiText}>
                {option}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <TextInput
        value={custom}
        onChangeText={onCustom}
        placeholder="Ou digite/cole outro emoji do seu teclado"
        placeholderTextColor={colors.faint}
        style={[styles.input, styles.customInput]}
        autoCorrect={false}
      />

      <Text style={styles.label}>Cor</Text>
      <View style={styles.colors}>
        {PALETTE.map((option) => (
          <Pressable
            key={option}
            onPress={() => {
              tap()
              setColor(option)
            }}
            accessibilityRole="button"
            accessibilityLabel={`Cor ${option}`}
            accessibilityState={{ selected: color === option }}
            style={[styles.swatch, { backgroundColor: option }, color === option && styles.swatchOn]}
          />
        ))}
      </View>

      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable onPress={onClose} accessibilityRole="button" style={({ pressed }) => [styles.button, styles.cancel, pressed && styles.pressed]}>
          <Text style={styles.cancelText}>Cancelar</Text>
        </Pressable>
        <Pressable onPress={() => void save()} disabled={!canSave} accessibilityRole="button" style={({ pressed }) => [styles.button, styles.confirm, !canSave && styles.off, pressed && styles.pressed]}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.confirmText}>{editing ? 'Salvar' : 'Criar categoria'}</Text>}
        </Pressable>
      </View>

      {editing ? (
        <Pressable onPress={remove} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.delete, pressed && styles.pressed]}>
          <Text style={styles.deleteText}>Apagar categoria</Text>
        </Pressable>
      ) : null}
    </ScrollView>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: colors.backdrop, justifyContent: 'flex-end' },
  sheet: { maxHeight: '90%', backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 16, paddingTop: 16, borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 },
  previewBox: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  previewName: { flex: 1, color: colors.text, fontSize: 18, fontWeight: '600' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 16, marginBottom: 6 },
  input: { height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, fontSize: 16, paddingHorizontal: 14 },
  customInput: { marginTop: 8, height: 44, fontSize: 15 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  emojiCell: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'transparent', backgroundColor: colors.bg },
  emojiCellOn: { borderColor: colors.primary, backgroundColor: colors.cardHigh },
  emojiText: { fontSize: 24, lineHeight: 30, includeFontPadding: false },
  colors: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  swatch: { width: 34, height: 34, borderRadius: 17, borderWidth: 2, borderColor: 'transparent' },
  swatchOn: { borderColor: colors.primary },
  error: { color: colors.expense, fontSize: 14, textAlign: 'center', marginTop: 14 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 18 },
  button: { flex: 1, height: 52, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  cancel: { borderWidth: 1, borderColor: colors.border },
  cancelText: { color: colors.text, fontSize: 16, fontWeight: '600' },
  confirm: { backgroundColor: colors.primary },
  confirmText: { color: colors.onPrimary, fontSize: 16, fontWeight: '700' },
  off: { opacity: 0.35 },
  pressed: { opacity: 0.8 },
  delete: { height: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  deleteText: { color: colors.expense, fontSize: 15, fontWeight: '600' },
})
