export interface MobileRelease {
  version: string
  build_number: number
  min_build_number: number
  android_apk: string
  md5: string
  notes: string
}

export function parseRelease(value: unknown): MobileRelease | null {
  if (value === null) return null
  const v = value as MobileRelease
  if (!v || typeof v.version !== 'string' || !v.version.trim() || v.version.length > 30 ||
    !Number.isSafeInteger(v.build_number) || !Number.isSafeInteger(v.min_build_number) ||
    v.min_build_number < 1 || v.build_number < v.min_build_number ||
    typeof v.android_apk !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.apk$/.test(v.android_apk) ||
    typeof v.md5 !== 'string' || !/^[0-9a-f]{32}$/.test(v.md5) ||
    typeof v.notes !== 'string' || v.notes.length > 2000) throw new Error('Informações de atualização inválidas.')
  return v
}

export function requiresUpdate(release: MobileRelease | null, build: number): boolean {
  return release !== null && build < release.min_build_number
}
