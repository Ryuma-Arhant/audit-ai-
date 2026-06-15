import path from 'path'
import fs from 'fs/promises'
import { callClaude, MODEL_CAPABLE, MODEL_VISION } from '../../lib/claude'
import type { MessageParam, ContentBlock } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent } from './types'

export async function uiInferrer(auditId: string): Promise<InferredIntent[]> {
  return trackAgentRun(auditId, 'ui-inferrer', 1, { auditId }, async () => {
    const pages = await db.page.findMany({ where: { auditId } })
    const allIntents: InferredIntent[] = []

    const pagesToProcess = pages.slice(0, 5)

    // Pre-read all screenshots in parallel, aligned by index with pagesToProcess.
    const screenshots = await Promise.all(
      pagesToProcess.map(async (p) => {
        if (!p.screenshotPath) return null
        try {
          // screenshotPath is the API URL (/api/artifacts/{auditId}/{n}.png);
          // map it back to the on-disk location under data/artifacts/.
          const diskRel = p.screenshotPath.replace(/^\/api\/artifacts\//, '')
          const buf = await fs.readFile(path.join(process.cwd(), 'data', 'artifacts', diskRel))
          return buf.toString('base64')
        } catch {
          return null // no screenshot in test env — proceed text-only
        }
      })
    )

    for (let i = 0; i < pagesToProcess.length; i++) {
      const pageRecord = pagesToProcess[i]
      const screenshotBase64 = screenshots[i]
      const actions = (JSON.parse(pageRecord.actions) as Array<{ type: string; label: string; selector: string }>).slice(0, 20)
      if (actions.length === 0) continue

      const userText = `Analyze this web page and infer the purpose of each interactive element.

Page URL: ${pageRecord.url}
Page title: ${pageRecord.title ?? 'Unknown'}

Interactive elements:
${JSON.stringify(actions, null, 2)}

Return a JSON array:
[
  {
    "pageUrl": "${pageRecord.url}",
    "elementSelector": "#selector",
    "purpose": "submit-form",
    "elementType": "button",
    "confidence": 0.9
  }
]

Valid purposes: submit-form, navigate, open-modal, toggle-visibility, save-changes, delete-item, search, filter, sort, auth-login, auth-signup, auth-logout, other

Return ONLY the JSON array.`

      const messages: MessageParam[] = screenshotBase64
        ? [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } } as ContentBlock,
            { type: 'text', text: userText } as ContentBlock,
          ] }]
        : [{ role: 'user', content: userText }]

      const response = await callClaude({
        auditId,
        agentName: 'ui-inferrer',
        model: screenshotBase64 ? MODEL_VISION : MODEL_CAPABLE,
        messages,
        system: 'You are a UI analyst. Return only valid JSON.',
        maxTokens: 4096,
      })

      const text = response.content.find(b => b.type === 'text')?.text ?? '[]'
      try {
        const intents = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] ?? '[]') as InferredIntent[]
        allIntents.push(...intents)
      } catch { /* malformed JSON — skip page */ }
    }

    return allIntents
  })
}
