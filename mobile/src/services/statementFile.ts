import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { Platform } from 'react-native'
import { MAX_STATEMENT_BYTES } from './statementParser'

export async function pickStatement(): Promise<{ name: string; content: string } | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, base64: false })
  if (result.canceled) return null
  const asset = result.assets[0]
  const nativeFile = Platform.OS === 'web' ? null : new File(asset.uri)
  try {
    if (!/\.(csv|ofx)$/i.test(asset.name)) throw new Error('Selecione um arquivo .ofx ou .csv.')
    const size = asset.size ?? nativeFile?.size ?? 0
    if (!size || size > MAX_STATEMENT_BYTES) throw new Error('Selecione um extrato de até 2 MB.')
    const content = Platform.OS === 'web' ? await asset.file!.text() : await nativeFile!.text()
    if (content.includes('\uFFFD')) throw new Error('Arquivo com codificação incompatível. Exporte ou salve em UTF-8.')
    return { name: asset.name, content }
  } finally { if (nativeFile?.exists) nativeFile.delete() }
}
