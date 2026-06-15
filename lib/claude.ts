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

  await enforceCostCap(auditId)

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
  const price = model === MODEL_FAST ? PRICE_FAST : PRICE
  const costUsd =
    (inputTokens  / 1_000_000) * price.input +
    (outputTokens / 1_000_000) * price.output

  await db.tokenLog.create({
    data: { auditId, agentName, model, inputTokens, outputTokens, costUsd },
  })

  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  }
}

async function enforceCostCap(auditId: string): Promise<void> {
  const [audit, agg] = await Promise.all([
    db.audit.findUnique({ where: { id: auditId }, select: { config: true } }),
    db.tokenLog.aggregate({ where: { auditId }, _sum: { costUsd: true } }),
  ])
  const config = parseConfig<{ costLimitUsd?: number }>(audit?.config)
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
