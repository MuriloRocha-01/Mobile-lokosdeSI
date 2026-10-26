import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useRef, useState } from 'react'
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage } from '../services/api'
import { useAuth } from '../hooks/useAuth'
import { radius, shadow } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'

/** Servidor Railway pré-configurado; o usuário informa apenas a conta. */
export function LoginScreen() {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { signIn, sessionMessage } = useAuth()
  const insets = useSafeAreaInsets()
  const [registering, setRegistering] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const emailRef = useRef<TextInput>(null)
  const passwordRef = useRef<TextInput>(null)

  async function submit() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (registering && !name.trim()) throw new Error('Digite seu nome.')
      await signIn(email, password, registering ? name : undefined)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top + 48, paddingBottom: insets.bottom + 24 }]} keyboardShouldPersistTaps="handled">
        <View style={styles.logo}>
          <Image source={require('../assets/icon.png')} style={styles.logoImage} accessibilityLabel="Ícone Lokos de S.I" />
        </View>
        <Text style={styles.title}>Lokos de S.I</Text>
        <Text style={styles.subtitle}>Seu dinheiro e seus planos, sempre com você.</Text>

        <View style={styles.formCard}>
        <Text style={styles.formTitle}>{registering ? 'Crie sua conta' : 'Bem-vindo de volta'}</Text>
        <Text style={styles.formSubtitle}>{registering ? 'Informe seus dados para começar.' : 'Entre com seu e-mail e senha.'}</Text>

        {registering && <><Text style={styles.label}>Nome</Text><TextInput value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor={colors.faint} maxLength={100} autoCapitalize="words" style={styles.input} /></>}
        <Text style={styles.label}>E-mail</Text>
        <TextInput
          ref={emailRef}
          value={email}
          accessibilityLabel="E-mail"
          onChangeText={setEmail}
          placeholder="voce@exemplo.com"
          placeholderTextColor={colors.faint}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          returnKeyType="next"
          onSubmitEditing={() => passwordRef.current?.focus()}
          style={styles.input}
        />

        <Text style={styles.label}>Senha</Text>
        <View style={styles.passwordRow}>
        <TextInput
          ref={passwordRef}
          value={password}
          accessibilityLabel="Senha"
          onChangeText={setPassword}
          placeholder="Sua senha"
          placeholderTextColor={colors.faint}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          style={[styles.input, styles.passwordInput]}
        />
        <Pressable onPress={() => setShowPassword(value => !value)} accessibilityRole="button" accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'} style={styles.passwordToggle}><MaterialCommunityIcons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={22} color={colors.muted} /></Pressable>
        </View>

        {error || sessionMessage ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error || sessionMessage}
          </Text>
        ) : null}

        <Pressable onPress={() => void submit()} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonDim]}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{registering ? 'Criar conta' : 'Entrar na minha conta'}</Text>}
        </Pressable>

        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setRegistering(!registering); setError('') }} style={{ paddingVertical: 16 }}><Text style={{ color: colors.income, textAlign: 'center' }}>{registering ? 'Já tenho conta · Entrar' : 'Ainda não tenho conta · Criar conta'}</Text></Pressable>
        {registering && <Text style={styles.hint}>Senha com pelo menos 8 caracteres. Em seguida, vamos montar seu perfil financeiro.</Text>}
        </View>
        {!registering && <Text style={styles.hint}>Sua conexão já está configurada. Seus lançamentos ficam sincronizados com sua conta.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, gap: 8, width: '100%', maxWidth: 480, alignSelf: 'center' },
  logo: { width: 64, height: 64, borderRadius: 22, backgroundColor: colors.card, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  logoImage: { width: 64, height: 64 },
  title: { color: colors.text, fontSize: 32, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 23, marginBottom: 20 },
  formCard: { backgroundColor: colors.card, borderRadius: radius.xl, padding: 20, borderWidth: 1, borderColor: colors.border, ...shadow },
  formTitle: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: 6 },
  formSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 20, marginBottom: 12 },
  passwordRow: { position: 'relative' },
  passwordInput: { paddingRight: 52 },
  passwordToggle: { position: 'absolute', right: 4, top: 4, width: 44, height: 44, justifyContent: 'center', alignItems: 'center' },
  label: { color: colors.muted, fontSize: 13, marginTop: 10, marginBottom: 4 },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg, color: colors.text, paddingHorizontal: 14, fontSize: 16 },
  error: { color: colors.expense, fontSize: 14, lineHeight: 20, marginTop: 12 },
  button: { height: 56, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonDim: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.faint, fontSize: 13, lineHeight: 19, marginTop: 20 },
})
