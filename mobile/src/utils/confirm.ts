import { Alert, Platform } from 'react-native'

/**
 * Pergunta "tem certeza?" antes de uma ação sem volta. No celular é o `Alert` nativo; na prévia web
 * (`npm run web`, só para ver o layout) o `Alert.alert` não faz nada, então cai no `confirm` do navegador.
 */
export function confirmDestructive(title: string, message: string, confirmLabel: string, onConfirm: () => void): void {
  if (Platform.OS === 'web') {
    const ask = (globalThis as { confirm?: (text: string) => boolean }).confirm
    if (ask?.(`${title}\n${message}`)) onConfirm()
    return
  }
  Alert.alert(title, message, [
    { text: 'Cancelar', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ])
}
