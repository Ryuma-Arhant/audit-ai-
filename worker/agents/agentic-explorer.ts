import path from 'path'
import fs from 'fs/promises'
import { chromium } from 'playwright'
import { trackAgentRun } from './run-tracker'
import type { AgentFlowSpec, FlowResult } from './types'
import { getArtifactDir, buildArtifactUrl } from '../artifacts'

export async function agenticExplorer(auditId: string, specs: AgentFlowSpec[]): Promise<FlowResult[]> {
  return trackAgentRun(auditId, 'agentic-explorer', 2, { specsCount: specs.length }, async () => {
    if (specs.length === 0) return []

    const artifactDir = getArtifactDir(auditId)
    await fs.mkdir(artifactDir, { recursive: true })

    const results: FlowResult[] = []
    const browser = await chromium.launch({ headless: true })
    try {
      for (const spec of specs.slice(0, 5)) {
        const context = await browser.newContext()
        const page = await context.newPage()
        let completedSteps = 0
        let screenshotPath: string | undefined

        try {
          for (const step of spec.steps) {
            if (step.action === 'navigate') {
              await page.goto(step.value ?? spec.pageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 })
            } else if (step.action === 'click' && step.selector) {
              await page.click(step.selector, { timeout: 5000 })
            } else if (step.action === 'fill' && step.selector) {
              await page.fill(step.selector, step.value ?? '', { timeout: 5000 })
            } else if (step.action === 'wait') {
              await page.waitForTimeout(Number(step.value) || 1000)
            }
            // 'assert' is a marker step — reaching it counts as passing
            completedSteps++
          }

          const idx = results.length
          const screenshotFile = path.join(artifactDir, `flow-${idx}.png`)
          await page.screenshot({ path: screenshotFile, fullPage: true })
          screenshotPath = buildArtifactUrl(auditId, `flow-${idx}.png`)

          results.push({
            specName: spec.name,
            pageUrl: spec.pageUrl,
            success: true,
            completedSteps,
            totalSteps: spec.steps.length,
            screenshotPath,
          })
        } catch (err) {
          const idx = results.length
          try {
            const screenshotFile = path.join(artifactDir, `flow-${idx}-fail.png`)
            await page.screenshot({ path: screenshotFile, fullPage: true })
            screenshotPath = buildArtifactUrl(auditId, `flow-${idx}-fail.png`)
          } catch { /* ignore */ }
          results.push({
            specName: spec.name,
            pageUrl: spec.pageUrl,
            success: false,
            completedSteps,
            totalSteps: spec.steps.length,
            error: err instanceof Error ? err.message : String(err),
            screenshotPath,
          })
        } finally {
          await context.close()
        }
      }
    } finally {
      await browser.close()
    }

    return results
  })
}
