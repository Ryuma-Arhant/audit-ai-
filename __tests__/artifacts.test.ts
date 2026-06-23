import path from 'path'
import {
  getArtifactDir,
  buildArtifactUrl,
  resolveArtifactPath,
  InvalidArtifactPathError,
} from '../worker/artifacts'

describe('getArtifactDir', () => {
  test('joins cwd, data, artifacts, and auditId', () => {
    expect(getArtifactDir('abc123')).toBe(
      path.join(process.cwd(), 'data', 'artifacts', 'abc123')
    )
  })
})

describe('buildArtifactUrl', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  afterAll(() => {
    process.env = ORIGINAL_ENV
  })

  test('uses RENDER_EXTERNAL_URL when set', () => {
    process.env.RENDER_EXTERNAL_URL = 'https://promptproof-worker.onrender.com'
    expect(buildArtifactUrl('abc123', '0.png')).toBe(
      'https://promptproof-worker.onrender.com/artifacts/abc123/0.png'
    )
  })

  test('falls back to localhost with PORT when RENDER_EXTERNAL_URL unset', () => {
    delete process.env.RENDER_EXTERNAL_URL
    process.env.PORT = '9090'
    expect(buildArtifactUrl('abc123', '0.png')).toBe(
      'http://localhost:9090/artifacts/abc123/0.png'
    )
  })

  test('defaults to port 8080 when neither is set', () => {
    delete process.env.RENDER_EXTERNAL_URL
    delete process.env.PORT
    expect(buildArtifactUrl('abc123', '0.png')).toBe(
      'http://localhost:8080/artifacts/abc123/0.png'
    )
  })
})

describe('resolveArtifactPath', () => {
  test('resolves a normal filename under the audit dir', () => {
    expect(resolveArtifactPath('abc123', '0.png')).toBe(
      path.join(getArtifactDir('abc123'), '0.png')
    )
  })

  test.each(['..', '.', '../etc/passwd', 'a/b.png', 'a\\b.png'])(
    'rejects traversal-like filename %p',
    (filename) => {
      expect(() => resolveArtifactPath('abc123', filename)).toThrow(
        InvalidArtifactPathError
      )
    }
  )

  test.each(['..', '../x', 'a/b'])(
    'rejects traversal-like auditId %p',
    (auditId) => {
      expect(() => resolveArtifactPath(auditId, '0.png')).toThrow(
        InvalidArtifactPathError
      )
    }
  )
})
