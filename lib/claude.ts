import Anthropic from '@anthropic-ai/sdk'
import { db } from './db'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const MODEL_PRICING: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  'claude-sonnet-4-6':         { inputPerMTok: 3.0,  outputPerMTok: 15.0 },
  'claude-haiku-4-5-20251001': { inputPerMTok: 0.80, outputPerMTok: 4.0  },
}

export interface CallClaudeParams {
  auditId: string
  agentName: string
  model: string
  messages: Anthropic.MessageParam[]
  system?: string
  maxTokens?: number
}

export async function callClaude(params: CallClaudeParams): Promise<Anthropic.Message> {
  const { auditId, agentName, model, messages, system, maxTokens = 1024 } = params

  await enforceCostCap(auditId)

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    ...(system ? { system } : {}),
    messages,
  })

  const pricing = MODEL_PRICING[model] ?? { inputPerMTok: 3.0, outputPerMTok: 15.0 }
  const costUsd =
    (response.usage.input_tokens  / 1_000_000) * pricing.inputPerMTok +
    (response.usage.output_tokens / 1_000_000) * pricing.outputPerMTok

  await db.tokenLog.create({
    data: {
      auditId,
      agentName,
      model,
      inputTokens:  response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      costUsd,
    },
  })

  return response
}

async function enforceCostCap(auditId: string): Promise<void> {
  const [audit, agg] = await Promise.all([
    db.audit.findUnique({ where: { id: auditId }, select: { config: true } }),
    db.tokenLog.aggregate({ where: { auditId }, _sum: { costUsd: true } }),
  ])
  const config = JSON.parse(audit?.config ?? '{}') as { costLimitUsd?: number }
  const limit = config.costLimitUsd ?? 0.50
  const spent = agg._sum.costUsd ?? 0
  if (spent >= limit) {
    throw new CostCapError(
      `Cost cap $${limit} reached (spent $${spent.toFixed(4)}) for audit ${auditId}`
    )
  }
}

export class CostCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostCapError'
  }
}
