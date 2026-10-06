import type { ComponentProps } from 'react'
import type { MaterialCommunityIcons } from '@expo/vector-icons'

export type IconName = ComponentProps<typeof MaterialCommunityIcons>['name']

// O servidor guarda só um nome "de significado" para o ícone de cada categoria; aqui cada nome vira um ícone.
const ICONS: Record<string, IconName> = {
  salary: 'cash',
  freelance: 'briefcase',
  investments: 'trending-up',
  gift: 'gift',
  food: 'silverware-fork-knife',
  transport: 'car',
  subscriptions: 'repeat',
  education: 'school',
  leisure: 'gamepad-variant',
  health: 'heart-pulse',
  shopping: 'shopping',
  home: 'home',
  travel: 'airplane',
  pets: 'paw',
  other: 'tag',
}

export const iconFor = (icon: string): IconName => ICONS[icon] ?? 'tag'

/** O ícone é uma das chaves "de significado" do servidor (food, salary...)? */
export const isKnownIcon = (icon: string): boolean => Object.prototype.hasOwnProperty.call(ICONS, icon)

/** Uma categoria criada pela pessoa guarda um EMOJI no lugar da chave: qualquer coisa desconhecida com não-ASCII. */
export const isEmojiIcon = (icon: string): boolean => !isKnownIcon(icon) && /[^\x00-\x7F]/.test(icon)

/** Quantos pontos de código (não "letras" do JS) cabem num emoji: uma família com pele chega a ~11. */
export const MAX_EMOJI_CODE_POINTS = 12

/**
 * Limpa o que a pessoa digitou no campo de emoji: tira ASCII, espaços e caracteres de controle (teclados do
 * Android costumam acrescentar um espaço no fim). Se passar de `MAX_EMOJI_CODE_POINTS` devolve null — recusa em
 * vez de cortar, porque cortar uma sequência de emoji (família, pele) no meio gera um glifo quebrado.
 */
export function cleanEmojiInput(text: string): string | null {
  const kept = Array.from(text).filter((ch) => (ch.codePointAt(0) ?? 0) >= 0xa0 && !/\s/.test(ch))
  return kept.length > MAX_EMOJI_CODE_POINTS ? null : kept.join('')
}
