/**
 * @jest-environment jsdom
 */
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom'
import { ScoreRing } from '../components/ScoreRing'
import { FindingCard, UnverifiedCard } from '../components/FindingCard'
import { PipelineStatus } from '../components/PipelineStatus'

// ─── ScoreRing ───

describe('ScoreRing', () => {
  test('renders trust score value', () => {
    render(<ScoreRing trustScore={85} reliabilityScore={80} uxScore={90} durationMs={null} />)
    expect(screen.getByText('85')).toBeInTheDocument()
    expect(screen.getByText('TRUST SCORE')).toBeInTheDocument()
  })

  test('renders reliability and ux subscores', () => {
    render(<ScoreRing trustScore={70} reliabilityScore={65} uxScore={75} durationMs={null} />)
    expect(screen.getByText('65')).toBeInTheDocument()
    expect(screen.getByText('75')).toBeInTheDocument()
  })

  test('shows dash when reliabilityScore is null', () => {
    render(<ScoreRing trustScore={50} reliabilityScore={null} uxScore={null} durationMs={null} />)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThanOrEqual(2)
  })

  test('shows duration when durationMs provided', () => {
    render(<ScoreRing trustScore={80} reliabilityScore={80} uxScore={80} durationMs={3500} />)
    expect(screen.getByText('3.5s')).toBeInTheDocument()
  })

  test('does not show duration when durationMs is null', () => {
    render(<ScoreRing trustScore={80} reliabilityScore={80} uxScore={80} durationMs={null} />)
    expect(screen.queryByText(/s$/)).toBeNull()
  })

  test('does not show cost display', () => {
    render(<ScoreRing trustScore={80} reliabilityScore={80} uxScore={80} durationMs={null} />)
    expect(screen.queryByText(/\$0\.\d/)).toBeNull()
  })
})

// ─── FindingCard ───

const FINDING = {
  id: 'f1',
  severity: 'high',
  confidence: 0.9,
  source: 'deterministic',
  type: 'http_error',
  description: 'HTTP 404 on /missing-page',
  pageUrl: 'https://example.com/missing-page',
  unverified: false,
  reproduction: '1. Navigate to /missing-page\n2. Observe 404 response',
  screenshotPath: null,
}

describe('FindingCard', () => {
  test('renders severity badge, type label, description, and page URL', () => {
    render(<FindingCard finding={FINDING} />)
    expect(screen.getByText('high')).toBeInTheDocument()
    expect(screen.getByText('HTTP Error')).toBeInTheDocument()
    expect(screen.getByText('HTTP 404 on /missing-page')).toBeInTheDocument()
    expect(screen.getByText('https://example.com/missing-page')).toBeInTheDocument()
  })

  test('shows reproduction steps toggle when reproduction exists', () => {
    render(<FindingCard finding={FINDING} />)
    expect(screen.getByText('Reproduction steps')).toBeInTheDocument()
  })

  test('reproduction steps hidden by default, shown on click', () => {
    render(<FindingCard finding={FINDING} />)
    expect(screen.queryByText(/Navigate to \/missing-page/)).toBeNull()
    fireEvent.click(screen.getByText('Reproduction steps'))
    expect(screen.getByText(/Navigate to \/missing-page/)).toBeInTheDocument()
  })

  test('hides reproduction toggle when reproduction is null', () => {
    render(<FindingCard finding={{ ...FINDING, reproduction: null }} />)
    expect(screen.queryByText('Reproduction steps')).toBeNull()
  })

  test('shows confidence value', () => {
    render(<FindingCard finding={FINDING} />)
    expect(screen.getByText(/0\.9 conf/)).toBeInTheDocument()
  })

  test('renders unknown severity gracefully', () => {
    render(<FindingCard finding={{ ...FINDING, severity: 'unknown' }} />)
    expect(screen.getByText('unknown')).toBeInTheDocument()
  })
})

describe('UnverifiedCard', () => {
  test('renders Unverified badge and description', () => {
    render(<UnverifiedCard finding={{ ...FINDING, unverified: true, reproduction: null }} />)
    expect(screen.getByText('Unverified')).toBeInTheDocument()
    expect(screen.getByText('HTTP 404 on /missing-page')).toBeInTheDocument()
  })
})

// ─── PipelineStatus ───

function agentRun(agentName: string, phase: number, status: string, durationMs: number | null = null) {
  return { agentName, phase, status, durationMs, errorMessage: null }
}

describe('PipelineStatus', () => {
  test('shows crawl as waiting before any pages', () => {
    render(<PipelineStatus auditStatus="queued" pagesCrawled={0} agentRuns={[]} />)
    expect(screen.getByText('Crawl')).toBeInTheDocument()
  })

  test('shows crawl complete when pages crawled > 0', () => {
    render(<PipelineStatus auditStatus="running" pagesCrawled={5} agentRuns={[]} />)
    expect(screen.getByText('5 pages')).toBeInTheDocument()
  })

  test('shows agent error messages at bottom', () => {
    const failedRun = { agentName: 'ui-inferrer', phase: 1, status: 'failed', durationMs: null, errorMessage: 'API key invalid' }
    render(<PipelineStatus auditStatus="running" pagesCrawled={3} agentRuns={[failedRun]} />)
    expect(screen.getByText(/API key invalid/)).toBeInTheDocument()
  })

  test('shows all 6 phase rows', () => {
    render(<PipelineStatus auditStatus="complete" pagesCrawled={5} agentRuns={[]} />)
    expect(screen.getByText('Crawl')).toBeInTheDocument()
    expect(screen.getByText('Checks')).toBeInTheDocument()
    expect(screen.getByText('Phase A')).toBeInTheDocument()
    expect(screen.getByText('Phase B')).toBeInTheDocument()
    expect(screen.getByText('Phase C')).toBeInTheDocument()
    expect(screen.getByText('Synthesis')).toBeInTheDocument()
  })

  test('shows duration for completed phase', () => {
    render(<PipelineStatus auditStatus="complete" pagesCrawled={5} agentRuns={[
      agentRun('ui-inferrer', 1, 'complete', 2500),
    ]} />)
    expect(screen.getByText('2.5s')).toBeInTheDocument()
  })
})
