import { chromium, Browser } from 'playwright'

interface BrowserHandle {
  browser: Browser
  refCount: number
}

const _browsers = new Map<string, BrowserHandle>()

export async function getSharedBrowser(auditId: string): Promise<Browser> {
  const existing = _browsers.get(auditId)
  if (existing) {
    existing.refCount++
    return existing.browser
  }
  const browser = await chromium.launch({ headless: true })
  _browsers.set(auditId, { browser, refCount: 1 })
  return browser
}

export async function releaseSharedBrowser(auditId: string): Promise<void> {
  const handle = _browsers.get(auditId)
  if (!handle) return
  handle.refCount--
  if (handle.refCount <= 0) {
    _browsers.delete(auditId)
    await handle.browser.close()
  }
}
