export const SERVER_URL = 'https://backend-production-5c98b.up.railway.app'

export function canRestoreSession(savedServer: string | null): boolean {
  return savedServer?.replace(/\/$/, '') === SERVER_URL
}
