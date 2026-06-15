import { getSharedBrowser, releaseSharedBrowser } from '../browser'
import { db } from '../../lib/db'

const STALL_SELECTORS = [
  '[class*="loading"]',
  '[class*="spinner"]',
  '[class*="skeleton"]',
  '[aria-label*="loading" i]',
  '[data-testid*="loading"]',
]
const STALL_TEXT_RE = /^\s*(loading|please wait|fetching|processing)[\s.…]*$/i
const WAIT_MS = 5000

export async function checkStalls(auditId: string): Promise<void> {
  const pages = await db.page.findMany({ where: { auditId } })

  const browser = await getSharedBrowser(auditId)
  try {
    for (const pageRecord of pages) {
      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(pageRecord.urlRaw, { waitUntil: 'domcontentloaded', timeout: 15000 })
        await page.waitForTimeout(WAIT_MS)

        let stalledSelector: string | null = null

        for (const sel of STALL_SELECTORS) {
          const el = await page.$(sel)
          if (!el) continue
          const visible = await el.isVisible()
          if (visible) { stalledSelector = sel; break }
        }

        if (!stalledSelector) {
          const texts: string[] = await page.evaluate(() => {
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
            const result: string[] = []
            let node: Node | null
            while ((node = walker.nextNode())) {
              const el = node.parentElement
              if (!el) continue
              const s = window.getComputedStyle(el)
              if (s.display !== 'none' && s.visibility !== 'hidden') {
                result.push(node.textContent ?? '')
              }
            }
            return result
          })
          const stallText = texts.find(t => STALL_TEXT_RE.test(t))
          if (stallText) stalledSelector = `text="${stallText.trim()}"`
        }

        if (stalledSelector) {
          await db.finding.create({
            data: {
              auditId,
              pageId: pageRecord.id,
              source: 'deterministic',
              type: 'stall',
              severity: 'high',
              confidence: 0.9,
              unverified: false,
              pageUrl: pageRecord.url,
              description: `UI stalled — loading indicator still visible after ${WAIT_MS / 1000}s`,
              domEvidence: `Stalled element: ${stalledSelector}`,
            },
          })
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await releaseSharedBrowser(auditId)
  }
}
