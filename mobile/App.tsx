import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { AuthProvider } from './src/hooks/useAuth'
import { AppRoutes } from './src/routes/AppRoutes'
import { ThemeProvider, useTheme } from './src/hooks/useTheme'

function ThemedApp() {
  const { mode } = useTheme()
  return <><StatusBar style={mode === 'dark' ? 'light' : 'dark'} /><AppRoutes /></>
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ThemedApp />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  )
}
