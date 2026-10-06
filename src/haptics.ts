import * as Haptics from 'expo-haptics'
import { Platform } from 'react-native'

// Vibração curtinha ao tocar: o teclado numérico "responde" mesmo com o celular no bolso ou no sol.
// No navegador (teste no computador) não faz nada.

export function tap(): void {
  if (Platform.OS === 'web') return
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
}

export function success(): void {
  if (Platform.OS === 'web') return
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {})
}

export function warning(): void {
  if (Platform.OS === 'web') return
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
}
