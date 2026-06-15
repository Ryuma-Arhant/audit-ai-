export function parseConfig<T extends object>(raw: string | null | undefined): T {
  try {
    return JSON.parse(raw ?? '{}') as T
  } catch {
    return {} as T
  }
}
