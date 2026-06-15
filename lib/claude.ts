import { ChatOpenAI } from '@langchain/openai'
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages'
import { db } from './db'
import { parseConfig } from './config'

// ─── Local message types ───

export interface TextBlock {
  type: 'text'
  text: string
}

export interface ImageBlock {
  type: 'image'
  source: { type: 'base64'; media_type: string; data: string }
}

export type ContentBlock = TextBlock | ImageBlock

export interface MessageParam {
  role: 'user' | 'assistant'
  content: string | ContentBlock[]
}

export interface LLMResponse {
  content: Array<{ type: 'text'; text: string }>
  usage: { input_tokens: number; output_tokens: number }
}

// ─── Model constants ───

export const MODEL_CAPABLE = 'nvidia/nemotron-3-ultra-550b-a55b'
export const MODEL_FAST    = 'meta/llama-3.1-8b-instruct'
export const MODEL_VISION  = 'meta/llama-3.2-90b-vision-instruct'

const NVIDIA_BASE_URL = 'https://integrate.api.nvidia.com/v1'

// Pricing for nemotron-3-ultra-550b (MODEL_CAPABLE): $8/MTok in+out
const PRICE: { input: number; output: number } = { input: 8.0, output: 8.0 }

// Pricing for llama-3.1-8b-instruct (MODEL_FAST): $0.18/MTok in+out
const PRICE_FAST: { input: number; output: number } = { input: 0.18, output: 0.18 }

// ─── Per-audit in-process cost accumulator ───

// Tracks accumulated spend per audit atomically in-process to prevent a
// TOCTOU race where two concurrent callClaude calls both pass the cost-cap
// check (reading the same DB total) before either logs its cost.
// Seeded from DB on first call per audit; updated before each LLM call.
const _auditCostMap = new Map<string, number>()  // auditId -> accumulated cost
const _auditLimitMap = new Map<string, number>() // auditId -> cost limit

export function clearAuditCostCache(auditId: string): void {
  _auditCostMap.delete(auditId)
  _auditLimitMap.delete(auditId)
}

// ─── callClaude ───

export interface CallClaudeParams {
  auditId: string
  agentName: string
  model: string
  messages: MessageParam[]
  system?: string
  maxTokens?: number
}

export async function callClaude(params: CallClaudeParams): Promise<LLMResponse> {
  const { auditId, agentName, model, messages, system, maxTokens = 1024 } = params

  // Select price up-front so we can estimate cost for the cap check.
  const price = model === MODEL_FAST ? PRICE_FAST : PRICE

  // Conservative upper bound: maxTokens output + ~2000 input tokens.
  const estimatedCost =
    (2000 / 1_000_000) * price.input +
    (maxTokens / 1_000_000) * price.output

  await enforceCostCap(auditId, estimatedCost)

  const llm = new ChatOpenAI({
    model,
    apiKey: process.env.NVIDIA_API_KEY ?? '',
    configuration: { baseURL: NVIDIA_BASE_URL },
    maxTokens,
    temperature: 0.2,
    timeout: 120_000,
  })

  const lcMessages = []
  if (system) lcMessages.push(new SystemMessage(system))

  for (const msg of messages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        lcMessages.push(new HumanMessage(msg.content))
      } else {
        const parts = msg.content.map(block => {
          if (block.type === 'image') {
            return {
              type: 'image_url' as const,
              image_url: { url: `data:${block.source.media_type};base64,${block.source.data}` },
            }
          }
          return { type: 'text' as const, text: block.text }
        })
        lcMessages.push(new HumanMessage({ content: parts }))
      }
    } else {
      lcMessages.push(new AIMessage(typeof msg.content === 'string' ? msg.content : ''))
    }
  }

  const response = await llm.invoke(lcMessages)

  const text = typeof response.content === 'string'
    ? response.content
    : (response.content as Array<{ type: string; text?: string }>)
        .find(b => b.type === 'text')?.text ?? ''

  const inputTokens  = response.usage_metadata?.input_tokens  ?? 0
  const outputTokens = response.usage_metadata?.output_tokens ?? 0
  const costUsd =
    (inputTokens  / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output

  await db.tokenLog.create({
    data: { auditId, agentName, model, inputTokens, outputTokens, costUsd },
  })

  // Replace the reserved estimate with the actual cost in the accumulator.
  _auditCostMap.set(
    auditId,
    (_auditCostMap.get(auditId) ?? estimatedCost) - estimatedCost + costUsd
  )

  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

async function enforceCostCap(auditId: string, estimatedCost: number): Promise<void> {
  // Seed the in-process accumulator from the DB on the first call per audit.
  if (!_auditCostMap.has(auditId)) {
    const [audit, agg] = await Promise.all([
      db.audit.findUnique({ where: { id: auditId }, select: { config: true } }),
      db.tokenLog.aggregate({ where: { auditId }, _sum: { costUsd: true } }),
    ])
    const config = parseConfig<{ costLimitUsd?: number }>(audit?.config)
    _auditLimitMap.set(auditId, config.costLimitUsd ?? 0.50)
    // Double-check: another concurrent call may have seeded the map while we awaited.
    if (!_auditCostMap.has(auditId)) {
      _auditCostMap.set(auditId, agg._sum.costUsd ?? 0)
    }
  }

  const limit = _auditLimitMap.get(auditId) ?? 0.50
  const current = _auditCostMap.get(auditId) ?? 0
  if (current + estimatedCost > limit) {
    throw new CostCapError(
      `Cost cap $${limit} reached (spent $${current.toFixed(4)}) for audit ${auditId}`
    )
  }
  // Reserve the estimated cost atomically before the LLM call. This guards
  // concurrent calls: the second caller sees the first's reservation and
  // throws if the cap would be exceeded.
  _auditCostMap.set(auditId, current + estimatedCost)
}

export class CostCapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CostCapError'
  }
}
