import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs/promises'
import { db } from '../lib/db'
import { getArtifactDir, buildArtifactUrl } from './artifacts'

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

export async function crawl(config: CrawlerConfig): Promise<void> {
  const { auditId, startUrl, maxPages } = config
  const origin = new URL(startUrl).origin

  const artifactDir = getArtifactDir(auditId)
  await fs.mkdir(artifactDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  try {
    const seen = new Set<string>()
    const seenPatterns = new Set<string>()

    const initialNorm = normalizeUrl(startUrl)
    seen.add(initialNorm)
    seenPatterns.add(urlToPattern(initialNorm))

    const queue: string[] = [startUrl]
    let pageIndex = 0

    while (queue.length > 0 && pageIndex < maxPages) {
      const rawUrl = queue.shift()!
      const context = await browser.newContext()
      const page = await context.newPage()

      const consoleLogs: ConsoleEntry[] = []
      const networkErrors: NetworkError[] = []

      page.on('console', msg => {
        if (msg.type() === 'error') {
          consoleLogs.push({ level: 'error', message: msg.text(), source: 'console' })
        }
      })
      page.on('requestfailed', req => {
        networkErrors.push({ url: req.url(), status: 0, method: req.method() })
      })

      try {
        const t0 = Date.now()
        const response = await page.goto(rawUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 30000,
        })
        const httpStatus = response?.status() ?? 0

        await page.waitForTimeout(300)

        const title = await page.title()

        const screenshotFile = path.join(artifactDir, `${pageIndex}.png`)
        await page.screenshot({ path: screenshotFile, fullPage: true })
        const screenshotPath = buildArtifactUrl(auditId, `${pageIndex}.png`)

        const links: LinkEntry[] = await page.$$eval('a[href]', els =>
          (els as HTMLAnchorElement[]).map(el => ({
            href: el.href,
            text: (el.textContent ?? '').trim(),
          }))
        )

        const actions: ActionEntry[] = await page.$$eval(
          'button, [role="button"], input[type="submit"], input[type="button"], select, input:not([type="hidden"]), textarea, form',
          els =>
            (els as HTMLElement[]).slice(0, 50).map(el => ({
              type: el.tagName.toLowerCase(),
              label:
                el.getAttribute('aria-label') ||
                (el.textContent ?? '').trim().slice(0, 80) ||
                el.getAttribute('placeholder') ||
                el.getAttribute('name') ||
                '',
              selector: el.id
                ? `#${el.id}`
                : el.className
                ? `.${el.className.split(' ')[0]}`
                : el.tagName.toLowerCase(),
            }))
        )

        const loadTimeMs = Date.now() - t0

        await db.page.create({
          data: {
            auditId,
            url: normalizeUrl(rawUrl),
            urlRaw: rawUrl,
            title: title || null,
            httpStatus,
            loadTimeMs,
            screenshotPath,
            consoleErrors: JSON.stringify(consoleLogs),
            networkErrors: JSON.stringify(networkErrors),
            links: JSON.stringify(links),
            actions: JSON.stringify(actions),
          },
        })

        pageIndex++
        await db.audit.update({
          where: { id: auditId },
          data: { pagesCrawled: pageIndex },
        })

        // Enqueue new same-origin, unseen links
        for (const link of links) {
          if (!link.href) continue
          let normalized: string
          try {
            normalized = normalizeUrl(link.href)
          } catch {
            continue
          }
          try {
            if (new URL(normalized).origin !== origin) continue
          } catch {
            continue
          }
          if (seen.has(normalized)) continue
          const pattern = urlToPattern(normalized)
          if (seenPatterns.has(pattern)) continue

          seen.add(normalized)
          seenPatterns.add(pattern)
          queue.push(link.href)
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
