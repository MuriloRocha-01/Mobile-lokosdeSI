import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Text } from 'react-native'
import { iconFor, isEmojiIcon } from '../categoryIcons'

interface Props {
  /** Chave padrão do servidor ("food"...) ou o emoji de uma categoria criada pela pessoa. */
  icon: string
  /** Cor do ícone (o emoji tem as próprias cores). */
  color: string
  size?: number
}

/** O desenho de uma categoria: ícone do Material para as padrão, o emoji para as da pessoa. */
export function CategoryBadge({ icon, color, size = 22 }: Props) {
  if (isEmojiIcon(icon)) {
    // `lineHeight` explícito: o Android corta o emoji quando a altura da linha é menor que a fonte.
    return (
      <Text allowFontScaling={false} style={{ fontSize: size, lineHeight: Math.round(size * 1.25), textAlign: 'center', includeFontPadding: false }}>
        {icon}
      </Text>
    )
  }
  return <MaterialCommunityIcons name={iconFor(icon)} size={size} color={color} />
}
