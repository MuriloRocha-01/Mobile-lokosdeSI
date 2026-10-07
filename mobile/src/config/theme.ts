// Paletas compartilhadas: a preferência e a troca reativa ficam em hooks/useTheme.
export const lightColors = {
  bg: '#F6F5FA',
  card: '#FFFFFF',
  cardHigh: '#EEECF5',
  border: '#E5E2EE',
  text: '#242136',
  muted: '#625D74',
  faint: '#716B82',
  income: '#12775D',
  expense: '#BD3C51',
  primary: '#6250D9',
  primarySoft: '#EEEAFF',
  primaryBorder: '#DED7FF',
  onPrimary: '#FFFFFF',
  successSoft: '#EAF6F0',
  dangerSoft: '#FFF0F2',
  backdrop: 'rgba(36,33,54,0.28)',
} as const

export type ThemeColors = { [Key in keyof typeof lightColors]: string }
export type ThemeMode = 'light' | 'dark'

export const darkColors: ThemeColors = {
  bg: '#090909',
  card: '#222222',
  cardHigh: '#303030',
  border: '#393939',
  text: '#F8F8F8',
  muted: '#C7C7C7',
  faint: '#ABABAB',
  income: '#65D6B3',
  expense: '#FF91A1',
  primary: '#FFFFFF',
  primarySoft: '#2C2C2C',
  primaryBorder: '#454545',
  onPrimary: '#111111',
  successSoft: '#1B3026',
  dangerSoft: '#332023',
  backdrop: 'rgba(0,0,0,0.62)',
}

export const radius = { md: 16, lg: 22, xl: 28 } as const

export const shadow = {
  shadowColor: '#312663',
  shadowOpacity: 0.06,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 6 },
  elevation: 2,
} as const
