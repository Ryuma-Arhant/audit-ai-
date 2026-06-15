import { getSharedBrowser, releaseSharedBrowser } from '../browser'
import { db } from '../../lib/db'

const TEST_VALUE = 'promptproof-test-1234'

interface ActionEntry { type: string; label: string; selector: string }

export async function checkPersistence(auditId: string): Promise<void> {
  const pages = await db.page.findMany({ where: { auditId } })

  const browser = await getSharedBrowser(auditId)
  try {
    for (const pageRecord of pages) {
      const actions: ActionEntry[] = JSON.parse(pageRecord.actions)
      const inputs = actions.filter(a => a.type === 'input' || a.type === 'textarea')
      const submitBtns = actions.filter(
        a => a.type === 'button' || (a.type === 'input' && /submit/i.test(a.label))
      )
      if (inputs.length === 0 || submitBtns.length === 0) continue

      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(pageRecord.urlRaw, { waitUntil: 'domcontentloaded', timeout: 15000 })
        await page.waitForTimeout(300)

        const inputHandle = await page.$(inputs[0].selector)
        if (!inputHandle) continue
        await inputHandle.fill(TEST_VALUE)

        const submitHandle = await page.$(submitBtns[0].selector)
        if (!submitHandle) continue
        await submitHandle.click({ timeout: 3000 }).catch(() => null)
        await page.waitForTimeout(500)

        // Reload and check if data survived
        await page.goto(pageRecord.urlRaw, { waitUntil: 'domcontentloaded', timeout: 15000 })
        await page.waitForTimeout(300)

        const lsAfter = await page.evaluate(() => JSON.stringify(localStorage))
        const domAfter = await page.evaluate(() => document.body.textContent ?? '')

        if (!domAfter.includes(TEST_VALUE) && !lsAfter.includes(TEST_VALUE)) {
          await db.finding.create({
            data: {
              auditId,
              pageId: pageRecord.id,
              source: 'deterministic',
              type: 'persistence_loss',
              severity: 'critical',
              confidence: 0.7,
              unverified: false,
              pageUrl: pageRecord.url,
              description: 'Data entered in form was not persisted — test value absent after page reload',
              domEvidence: `Input: ${inputs[0].selector} | Submit: ${submitBtns[0].selector}`,
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
