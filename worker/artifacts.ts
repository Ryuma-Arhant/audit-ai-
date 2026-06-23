import path from 'path'

export function getArtifactDir(auditId: string): string {
  return path.join(process.cwd(), 'data', 'artifacts', auditId)
}

export function buildArtifactUrl(auditId: string, filename: string): string {
  const base =
    process.env.RENDER_EXTERNAL_URL ?? `http://localhost:${process.env.PORT ?? '8080'}`
  return `${base}/artifacts/${auditId}/${filename}`
}

export class InvalidArtifactPathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidArtifactPathError'
  }
}

function isSafeSegment(segment: string): boolean {
  return (
    segment !== '' &&
    segment !== '.' &&
    segment !== '..' &&
    !segment.includes('/') &&
    !segment.includes('\\')
  )
}

export function resolveArtifactPath(auditId: string, filename: string): string {
  if (!isSafeSegment(auditId) || !isSafeSegment(filename)) {
    throw new InvalidArtifactPathError(`Invalid artifact path: ${auditId}/${filename}`)
  }

  const dir = getArtifactDir(auditId)
  const filePath = path.join(dir, filename)

  if (!filePath.startsWith(dir + path.sep)) {
    throw new InvalidArtifactPathError(`Invalid artifact path: ${auditId}/${filename}`)
  }

  return filePath
}
