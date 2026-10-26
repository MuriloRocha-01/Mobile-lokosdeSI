import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ActivityIndicator, AppState, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import * as Application from 'expo-application'
import * as FileSystem from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import { useAuth } from '../hooks/useAuth'
import { getItem, setItem } from '../services/storage'
import { parseRelease, requiresUpdate, type MobileRelease } from '../utils/updatesPolicy'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'

export function UpdateGate({ children }: { children: ReactNode }) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const { server } = useAuth()
  const enabled = Platform.OS === 'android' && !__DEV__ && Boolean(server)
  const build = Number(Application.nativeBuildVersion ?? 0)
  const [checking, setChecking] = useState(enabled)
  const [release, setRelease] = useState<MobileRelease | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<number | null>(null)
  const [apk, setApk] = useState<string | null>(null)
  const downloading = useRef(false)
  const task = useRef<FileSystem.DownloadResumable | null>(null)
  const mandatory = enabled && requiresUpdate(release, build)

  const check = useCallback(async () => {
    if (!enabled) return
    const key = 'mobile.release.' + Array.from(server).map(c => c.charCodeAt(0).toString(16)).join('-')
    let known: MobileRelease | null = null
    try { const cached = await getItem(key); if (cached) known = parseRelease(JSON.parse(cached)) } catch { /* Revalida na rede. */ }
    if (known) setRelease(known)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 12000)
    try {
      if (!server.startsWith('https://')) throw new Error('Use HTTPS no servidor para baixar atualizações com segurança.')
      const response = await fetch(server.replace(/\/$/, '') + '/updates/mobile/manifest', { signal: controller.signal, headers: { 'Cache-Control': 'no-cache' } })
      if (!response.ok) throw new Error('Não foi possível verificar a atualização. Tente novamente.')
      const next = parseRelease(await response.json())
      // Uma falha de publicação não libera uma versão que já foi marcada como obrigatória.
      const latest = known && (!next || known.min_build_number > next.min_build_number) ? known : next
      setRelease(latest)
      await setItem(key, JSON.stringify(latest))
      setError('')
    } catch (err) { setError(err instanceof Error ? err.message : 'Falha ao verificar atualização.') }
    finally { clearTimeout(timer); setChecking(false) }
  }, [server, enabled])

  useEffect(() => {
    setRelease(null); setApk(null); setChecking(enabled)
    void check()
    const listener = AppState.addEventListener('change', state => { if (state === 'active') void check() })
    return () => { listener.remove(); void task.current?.pauseAsync().catch(() => {}) }
  }, [check, enabled])

  const download = useCallback(async () => {
    if (!release || downloading.current) return
    downloading.current = true; setError(''); setProgress(0)
    try {
      if (!server.startsWith('https://') || !FileSystem.cacheDirectory) throw new Error('O download precisa de um servidor HTTPS e espaço disponível no celular.')
      const target = FileSystem.cacheDirectory + 'mobile-' + release.build_number + '.apk'
      task.current = FileSystem.createDownloadResumable(server.replace(/\/$/, '') + '/updates/' + encodeURIComponent(release.android_apk), target, {}, p => setProgress(p.totalBytesExpectedToWrite > 0 ? Math.round(100 * p.totalBytesWritten / p.totalBytesExpectedToWrite) : 0))
      const result = await task.current.downloadAsync()
      if (!result || result.status !== 200) throw new Error('Download interrompido. Tente novamente.')
      const info = await FileSystem.getInfoAsync(target, { md5: true })
      if (!info.exists || info.md5 !== release.md5) { await FileSystem.deleteAsync(target, { idempotent: true }); throw new Error('Arquivo incompleto ou inválido. Baixe novamente.') }
      setApk(target)
    } catch (err) { setError(err instanceof Error ? err.message : 'Não foi possível baixar a atualização.') }
    finally { downloading.current = false; setProgress(null) }
  }, [release, server])

  useEffect(() => { if (mandatory && !apk) void download() }, [mandatory, release?.build_number])

  async function install() {
    try {
      if (!apk) return
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: await FileSystem.getContentUriAsync(apk), flags: 1, type: 'application/vnd.android.package-archive' })
    } catch { setError('Autorize este aplicativo a instalar atualizações nas configurações do Android e tente novamente.') }
  }

  if (!mandatory && !checking) return children
  return <View style={styles.page}>
    <Text style={styles.title}>{mandatory ? 'Uma nova versão está pronta' : 'Verificando atualização'}</Text>
    {mandatory ? <><Text style={styles.text}>Atualize para a versão {release?.version} para continuar. Seus registros e histórico serão mantidos.</Text>{release?.notes ? <Text style={styles.text}>{release.notes}</Text> : null}<Text style={styles.text}>{progress !== null ? `Baixando atualização · ${progress}%` : apk ? 'Download concluído. Confirme a instalação no Android.' : 'A atualização será baixada automaticamente.'}</Text></> : null}
    {checking || progress !== null ? <ActivityIndicator color={colors.text} /> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    {mandatory && progress === null ? <Pressable accessibilityRole="button" style={styles.button} onPress={() => void (apk ? install() : download())}><Text style={styles.buttonText}>{apk ? 'Instalar atualização' : 'Tentar baixar novamente'}</Text></Pressable> : null}
  </View>
}
const createStyles = (colors: ThemeColors) => StyleSheet.create({ page: { flex: 1, backgroundColor: colors.bg, padding: 28, justifyContent: 'center', gap: 20 }, title: { color: colors.text, fontSize: 26, fontWeight: '700' }, text: { color: colors.muted, fontSize: 16, lineHeight: 24 }, error: { color: colors.expense }, button: { backgroundColor: colors.primary, padding: 16, borderRadius: 16, alignItems: 'center' }, buttonText: { color: colors.onPrimary, fontWeight: '700' } })
