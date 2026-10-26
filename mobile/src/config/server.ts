export const DEFAULT_SERVER_URL = 'https://mobile-lokosdesi-backend.onrender.com'
export const SERVER_URL = DEFAULT_SERVER_URL

export function canRestoreSession(savedServer: string | null): boolean {
  return savedServer?.replace(/\/$/, '') === SERVER_URL
}
