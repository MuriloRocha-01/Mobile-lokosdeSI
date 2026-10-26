import { Image, StyleSheet, View } from 'react-native'

/** Fundo decorativo local: nenhum conteúdo financeiro faz parte da imagem. */
export function IridescentBackdrop() {
  return (
    <View pointerEvents="none" accessible={false} style={StyleSheet.absoluteFill}>
      <Image source={require('../assets/iridescent-card.png')} resizeMode="cover" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, styles.veil]} />
    </View>
  )
}

const styles = StyleSheet.create({ veil: { backgroundColor: 'rgba(0,0,0,0.22)' } })
