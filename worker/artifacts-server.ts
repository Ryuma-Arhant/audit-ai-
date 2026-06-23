import http from 'http'
import fs from 'fs/promises'
import { resolveArtifactPath, InvalidArtifactPathError } from './artifacts'

export function createArtifactsServer(): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')

    if (url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('ok')
      return
    }

    const match = url.pathname.match(/^\/artifacts\/([^/]+)\/([^/]+)$/)
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
      return
    }

    const [, auditId, filename] = match
    try {
      const filePath = resolveArtifactPath(auditId, filename)
      const buf = await fs.readFile(filePath)
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Cache-Control': 'private, max-age=3600',
      })
      res.end(buf)
    } catch (err) {
      if (err instanceof InvalidArtifactPathError) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid path' }))
        return
      }
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not found' }))
    }
  })
}

export function startArtifactsServer(port: number): http.Server {
  const server = createArtifactsServer()
  server.listen(port)
  return server
}
