import { Platform, TurboModuleRegistry } from 'react-native'
export const widgetsSupported = Platform.OS === 'android' && TurboModuleRegistry.get('AndroidWidget') !== null
export const WIDGET_NAMES = ['FinanceSummary', 'FinanceAgenda'] as const
export function registerWidgets() {
  if (widgetsSupported) require('./native').registerWidgets()
}
export async function refreshWidgets() {
  if (widgetsSupported) await require('./native').refreshWidgets()
}
export async function clearWidgets() {
  if (widgetsSupported) await require('./native').clearWidgets()
}
export async function pinWidget(widgetName: typeof WIDGET_NAMES[number]): Promise<boolean> {
  if (!widgetsSupported) return false
  return require('./native').pinWidget(widgetName)
}
