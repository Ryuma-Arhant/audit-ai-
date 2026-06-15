const WINDOW_MS = 60_000   // 1 minute
const MAX_REQUESTS = 5

// Map<ip, timestamps of requests within the window>
const _windows = new Map<string, number[]>()

export function checkRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now()
  const timestamps = (_windows.get(ip) ?? []).filter(t => now - t < WINDOW_MS)
  if (timestamps.length >= MAX_REQUESTS) {
    const oldest = timestamps[0]
    const retryAfterSec = Math.ceil((oldest + WINDOW_MS - now) / 1000)
    _windows.set(ip, timestamps)
    return { allowed: false, retryAfterSec }
  }
  timestamps.push(now)
  _windows.set(ip, timestamps)
  return { allowed: true, retryAfterSec: 0 }
}

// Test-only: clear all tracked windows so module-level state does not leak
// between tests that import this module statically.
export function _resetRateLimit(): void {
  _windows.clear()
}
