import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

// No celular, o que é sensível (o token de login) fica no cofre do sistema (Keychain/Keystore).
// No navegador (só para testar o layout no computador) o SecureStore não existe: usa o localStorage.

export async function getItem(key: string): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return globalThis.localStorage?.getItem(key) ?? null
    return await SecureStore.getItemAsync(key)
  } catch {
    return null
  }
}

export async function setItem(key: string, value: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(key, value)
    else await SecureStore.setItemAsync(key, value)
  } catch {
    /* sem armazenamento: o app funciona, só pede login de novo na próxima vez */
  }
}

export async function removeItem(key: string): Promise<void> {
  try {
    if (Platform.OS === 'web') globalThis.localStorage?.removeItem(key)
    else await SecureStore.deleteItemAsync(key)
  } catch {
    /* idem */
  }
}
