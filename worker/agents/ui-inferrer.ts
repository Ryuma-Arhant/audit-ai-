import path from 'path'
import fs from 'fs/promises'
import type { ContentBlockParam, MessageParam } from '@anthropic-ai/sdk'
import { callClaude } from '../../lib/claude'
import { db } from '../../lib/db'
import { trackAgentRun } from './run-tracker'
import type { InferredIntent } from './types'

export async function uiInferrer(auditId: string): Promise<InferredIntent[]> {
  return trackAgentRun(auditId, 'ui-inferrer', 1, { auditId }, async () => {
    const pages = await db.page.findMany({ where: { auditId } })
    const allIntents: InferredIntent[] = []

    for (const pageRecord of pages.slice(0, 5)) {
      const actions = JSON.parse(pageRecord.actions) as Array<{ type: string; label: string; selector: string }>
      if (actions.length === 0) continue

      let screenshotBase64: string | null = null
      if (pageRecord.screenshotPath) {
        try {
          const buf = await fs.readFile(path.join(process.cwd(), 'public', pageRecord.screenshotPath))
          screenshotBase64 = buf.toString('base64')
        } catch { /* no screenshot in test env — proceed text-only */ }
      }

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
            { type: 'image', source: { type: 'base64', media_type: 'image/png', data: screenshotBase64 } } as ContentBlockParam,
            { type: 'text', text: userText } as ContentBlockParam,
          ] }]
        : [{ role: 'user', content: userText }]

      const response = await callClaude({
        auditId,
        agentName: 'ui-inferrer',
        model: 'claude-sonnet-4-6',
        messages,
        system: 'You are a UI analyst. Return only valid JSON.',
        maxTokens: 1024,
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
