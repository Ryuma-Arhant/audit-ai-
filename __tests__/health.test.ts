import { GET } from '@/app/api/health/route'
import { db } from '@/lib/db'

afterAll(() => db.$disconnect())

test('GET /api/health returns 200 with status ok', async () => {
  const res = await GET()
  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body.status).toBe('ok')
  expect(body.db).toBe('ok')
  expect(typeof body.ts).toBe('string')
})
