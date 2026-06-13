import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs/promises'
import { db } from '../lib/db'

const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source',
  'page', 'p', 'offset',
  'filter', 'sort', 'order',
  'sid', 'session', 'token',
])
const STRIP_PARAM_PREFIXES = ['utm_']

export function normalizeUrl(rawUrl: string): string {
  const u = new URL(rawUrl)
  const keep = new URLSearchParams()
  for (const [k, v] of u.searchParams.entries()) {
    const lower = k.toLowerCase()
    if (STRIP_PARAMS.has(lower)) continue
    if (STRIP_PARAM_PREFIXES.some(p => lower.startsWith(p))) continue
    keep.set(k, v)
  }
  u.search = keep.toString()
  return u.toString()
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NUMERIC_RE = /^\d+$/
const CUID_RE = /^c[a-z0-9]{24,}$/i

export function urlToPattern(rawUrl: string): string {
  const u = new URL(rawUrl)
  u.pathname = u.pathname
    .split('/')
    .map(seg => {
      if (NUMERIC_RE.test(seg)) return ':id'
      if (UUID_RE.test(seg)) return ':id'
      if (CUID_RE.test(seg)) return ':id'
      return seg
    })
    .join('/')
  u.search = ''
  u.hash = ''
  return u.toString()
}

export interface CrawlerConfig {
  auditId: string
  startUrl: string
  maxPages: number
}

interface ConsoleEntry { level: string; message: string; source: string }
interface NetworkError { url: string; status: number; method: string }
interface LinkEntry { href: string; text: string }
interface ActionEntry { type: string; label: string; selector: string }

export async function crawl(_config: CrawlerConfig): Promise<void> {
  throw new Error('crawl() not yet implemented')
}
