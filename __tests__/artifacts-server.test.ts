import path from 'path'
import fs from 'fs/promises'
import http from 'http'
import { startArtifactsServer } from '../worker/artifacts-server'
import { getArtifactDir } from '../worker/artifacts'

function get(port: number, pathName: string): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    http
      .get({ port, path: pathName }, (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }))
      })
      .on('error', reject)
  })
}

describe('artifacts server', () => {
  const auditId = 'test-audit-server'
  const port = 8765
  let server: http.Server

  beforeAll(async () => {
    const dir = getArtifactDir(auditId)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, '0.png'), Buffer.from([1, 2, 3]))
    server = startArtifactsServer(port)
    await new Promise<void>((resolve) => server.once('listening', resolve))
  })

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve))
    await fs.rm(getArtifactDir(auditId), { recursive: true, force: true })
  })

  test('GET / returns 200 (health check)', async () => {
    const res = await get(port, '/')
    expect(res.status).toBe(200)
  })

  test('GET /artifacts/<auditId>/<file> returns the file bytes', async () => {
    const res = await get(port, `/artifacts/${auditId}/0.png`)
    expect(res.status).toBe(200)
    expect(res.body).toEqual(Buffer.from([1, 2, 3]))
  })

  test('GET missing file returns 404', async () => {
    const res = await get(port, `/artifacts/${auditId}/missing.png`)
    expect(res.status).toBe(404)
  })

  test('GET a path-traversal style filename never returns 200', async () => {
    const res = await get(port, `/artifacts/${auditId}/..`)
    expect(res.status).not.toBe(200)
  })
})
