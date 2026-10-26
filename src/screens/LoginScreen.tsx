import { MaterialCommunityIcons } from '@expo/vector-icons'
import { useRef, useState } from 'react'
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { errorMessage } from '../api'
import { useAuth } from '../auth'
import { colors, radius } from '../theme'

/** Primeira tela: o endereço do servidor (o PC onde o Lokos de S.I roda) e a conta. Só na primeira vez. */
export function LoginScreen() {
  const { signIn, sessionMessage } = useAuth()
  const insets = useSafeAreaInsets()
  const [registering, setRegistering] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
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
          <MaterialCommunityIcons name="orbit" size={30} color={colors.onPrimary} />
        </View>
        <Text style={styles.title}>Lokos de S.I</Text>
        <Text style={styles.subtitle}>Entre na sua conta para organizar suas finanças.</Text>

        {registering && <><Text style={styles.label}>Nome</Text><TextInput value={name} onChangeText={setName} placeholder="Seu nome" placeholderTextColor={colors.faint} maxLength={100} autoCapitalize="words" style={styles.input} /></>}
        <Text style={styles.label}>E-mail</Text>
        <TextInput
          ref={emailRef}
          value={email}
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
        <TextInput
          ref={passwordRef}
          value={password}
          onChangeText={setPassword}
          placeholder="Sua senha"
          placeholderTextColor={colors.faint}
          secureTextEntry
          autoCapitalize="none"
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
          style={styles.input}
        />

        {error || sessionMessage ? (
          <Text style={styles.error} accessibilityRole="alert">
            {error || sessionMessage}
          </Text>
        ) : null}

        <Pressable onPress={() => void submit()} disabled={busy} accessibilityRole="button" style={({ pressed }) => [styles.button, (busy || pressed) && styles.buttonDim]}>
          {busy ? <ActivityIndicator color={colors.onPrimary} /> : <Text style={styles.buttonText}>{registering ? 'Criar conta' : 'Entrar'}</Text>}
        </Pressable>

        <Pressable accessibilityRole="button" disabled={busy} onPress={() => { setRegistering(!registering); setError('') }} style={{ paddingVertical: 16 }}><Text style={{ color: colors.income, textAlign: 'center' }}>{registering ? 'Já tenho conta · Entrar' : 'Ainda não tenho conta · Criar conta'}</Text></Pressable>
        {registering && <Text style={styles.hint}>Senha com pelo menos 8 caracteres. Em seguida, vamos montar seu perfil financeiro.</Text>}
      </ScrollView>
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: 24, gap: 6 },
  logo: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  subtitle: { color: colors.muted, fontSize: 15, lineHeight: 22, marginBottom: 20 },
  label: { color: colors.muted, fontSize: 13, marginTop: 10, marginBottom: 4 },
  input: { height: 52, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, color: colors.text, paddingHorizontal: 14, fontSize: 16 },
  error: { color: colors.expense, fontSize: 14, lineHeight: 20, marginTop: 12 },
  button: { height: 56, borderRadius: radius.lg, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonDim: { opacity: 0.7 },
  buttonText: { color: colors.onPrimary, fontSize: 17, fontWeight: '700' },
  hint: { color: colors.faint, fontSize: 13, lineHeight: 19, marginTop: 20 },
})
