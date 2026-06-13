import { chromium } from 'playwright'
import { db } from '../../lib/db'

interface ActionEntry { type: string; label: string; selector: string }

export async function checkActions(auditId: string): Promise<void> {
  const pages = await db.page.findMany({ where: { auditId } })

  const browser = await chromium.launch({ headless: true })
  try {
    for (const pageRecord of pages) {
      const actions: ActionEntry[] = JSON.parse(pageRecord.actions)
      const buttons = actions.filter(
        a => a.type === 'button' || (a.type === 'input' && /submit/i.test(a.label))
      )
      if (buttons.length === 0) continue

      const context = await browser.newContext()
      const page = await context.newPage()
      try {
        await page.goto(pageRecord.urlRaw, { waitUntil: 'domcontentloaded', timeout: 15000 })
        await page.waitForTimeout(300)

        for (const btn of buttons.slice(0, 5)) {
          const handle = await page.$(btn.selector)
          if (!handle) continue

          // Skip form submit buttons — covered by persistence check
          const tag = await handle.evaluate(el => el.tagName.toLowerCase())
          if (tag === 'form') continue
          const isFormSubmit = await handle.evaluate(el =>
            el.closest('form') !== null && (el as HTMLButtonElement).type === 'submit'
          )
          if (isFormSubmit) continue

          const domBefore = await page.evaluate(() => document.body.innerHTML.length)
          let navigated = false
          const navHandler = () => { navigated = true }
          page.once('framenavigated', navHandler)

          try {
            await handle.click({ timeout: 3000 })
          } catch {
            page.off('framenavigated', navHandler)
            continue
          }

          await page.waitForTimeout(2000)
          page.off('framenavigated', navHandler)

          if (navigated) continue

          const domAfter = await page.evaluate(() => document.body.innerHTML.length)
          const domChanged = Math.abs(domAfter - domBefore) > 20

          if (!domChanged) {
            await db.finding.create({
              data: {
                auditId,
                pageId: pageRecord.id,
                source: 'deterministic',
                type: 'action_failure',
                severity: 'critical',
                confidence: 0.7,
                unverified: false,
                pageUrl: pageRecord.url,
                description: `Button "${btn.label || btn.selector}" clicked but produced no DOM change`,
                domEvidence: `Selector: ${btn.selector}`,
              },
            })
            break // one finding per page
          }
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
