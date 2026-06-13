import { normalizeUrl, urlToPattern } from '../worker/crawler'

describe('normalizeUrl', () => {
  test('strips utm_ params', () => {
    expect(normalizeUrl('https://example.com/page?utm_source=twitter&utm_campaign=ads'))
      .toBe('https://example.com/page')
  })

  test('strips pagination params: page, p, offset', () => {
    expect(normalizeUrl('https://example.com/posts?page=2')).toBe('https://example.com/posts')
    expect(normalizeUrl('https://example.com/posts?p=3')).toBe('https://example.com/posts')
    expect(normalizeUrl('https://example.com/items?offset=20')).toBe('https://example.com/items')
  })

  test('strips filter, sort, order params', () => {
    expect(normalizeUrl('https://example.com/products?sort=asc&filter=red'))
      .toBe('https://example.com/products')
    expect(normalizeUrl('https://example.com/products?order=desc'))
      .toBe('https://example.com/products')
  })

  test('strips session/token params: token, sid, session', () => {
    expect(normalizeUrl('https://example.com/chat?token=abc123'))
      .toBe('https://example.com/chat')
    expect(normalizeUrl('https://example.com/app?sid=xyz&session=123'))
      .toBe('https://example.com/app')
  })

  test('strips fbclid and gclid', () => {
    expect(normalizeUrl('https://example.com/?fbclid=abc&gclid=def'))
      .toBe('https://example.com/')
  })

  test('strips ref and source params', () => {
    expect(normalizeUrl('https://example.com/?ref=homepage&source=nav'))
      .toBe('https://example.com/')
  })

  test('preserves non-tracking params', () => {
    expect(normalizeUrl('https://example.com/search?q=hello&lang=en'))
      .toBe('https://example.com/search?q=hello&lang=en')
  })

  test('preserves path and hash', () => {
    expect(normalizeUrl('https://example.com/about#section'))
      .toBe('https://example.com/about#section')
  })

  test('handles URL with no params', () => {
    expect(normalizeUrl('https://example.com/about'))
      .toBe('https://example.com/about')
  })

  test('handles mixed tracking and non-tracking params', () => {
    expect(normalizeUrl('https://example.com/search?q=test&utm_source=email'))
      .toBe('https://example.com/search?q=test')
  })
})

describe('urlToPattern', () => {
  test('replaces numeric path segments with :id', () => {
    expect(urlToPattern('https://example.com/chat/123'))
      .toBe('https://example.com/chat/:id')
    expect(urlToPattern('https://example.com/users/42/posts'))
      .toBe('https://example.com/users/:id/posts')
  })

  test('replaces UUID path segments with :id', () => {
    expect(urlToPattern('https://example.com/items/550e8400-e29b-41d4-a716-446655440000'))
      .toBe('https://example.com/items/:id')
  })

  test('replaces cuid-like segments with :id', () => {
    expect(urlToPattern('https://example.com/docs/clh1234567890abcdefghijklm'))
      .toBe('https://example.com/docs/:id')
  })

  test('does not replace non-id word segments', () => {
    expect(urlToPattern('https://example.com/about'))
      .toBe('https://example.com/about')
    expect(urlToPattern('https://example.com/users/profile'))
      .toBe('https://example.com/users/profile')
  })

  test('ignores query string in pattern output', () => {
    expect(urlToPattern('https://example.com/chat/123?lang=en'))
      .toBe('https://example.com/chat/:id')
  })
})
