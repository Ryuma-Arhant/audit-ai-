import { derivePhaseState, totalDuration, fmt } from '../components/PipelineStatus'

function run(status: string, durationMs: number | null = null, phase = 1) {
  return { agentName: 'test', phase, status, durationMs, errorMessage: null }
}

describe('derivePhaseState', () => {
  test('returns waiting when no runs', () => {
    expect(derivePhaseState([])).toBe('waiting')
  })

  test('returns running when any run is running', () => {
    expect(derivePhaseState([run('running'), run('complete')])).toBe('running')
  })

  test('returns complete when all runs complete', () => {
    expect(derivePhaseState([run('complete'), run('complete')])).toBe('complete')
  })

  test('returns partial when some complete and some failed', () => {
    expect(derivePhaseState([run('complete'), run('failed')])).toBe('partial')
  })

  test('returns failed when all runs failed', () => {
    expect(derivePhaseState([run('failed')])).toBe('failed')
  })

  test('running takes priority over failed', () => {
    expect(derivePhaseState([run('running'), run('failed')])).toBe('running')
  })
})

describe('totalDuration', () => {
  test('returns null for empty runs', () => {
    expect(totalDuration([])).toBeNull()
  })

  test('returns max durationMs across runs', () => {
    expect(totalDuration([run('complete', 100), run('complete', 300), run('complete', 200)])).toBe(300)
  })

  test('treats null durationMs as 0', () => {
    expect(totalDuration([run('complete', null), run('complete', 500)])).toBe(500)
  })
})

describe('fmt', () => {
  test('returns empty string for null', () => {
    expect(fmt(null)).toBe('')
  })

  test('formats ms below 1000 as Xms', () => {
    expect(fmt(0)).toBe('0ms')
    expect(fmt(999)).toBe('999ms')
  })

  test('formats ms >= 1000 as X.Xs', () => {
    expect(fmt(1000)).toBe('1.0s')
    expect(fmt(2500)).toBe('2.5s')
    expect(fmt(30000)).toBe('30.0s')
  })
})
