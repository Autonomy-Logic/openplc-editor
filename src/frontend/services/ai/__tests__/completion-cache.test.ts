import { describe, expect, it } from '@jest/globals'

import { buildCacheKey, CompletionCache, hashString } from '../completion-cache'

describe('CompletionCache', () => {
  it('returns undefined on miss and the value on hit (with LRU promotion)', () => {
    const cache = new CompletionCache<string>(2)
    expect(cache.get('a')).toBeUndefined()
    expect(cache.has('a')).toBe(false)
    expect(cache.size).toBe(0)

    cache.set('a', 'one')
    cache.set('b', 'two')
    expect(cache.has('a')).toBe(true)
    expect(cache.size).toBe(2)

    // Hit promotes 'a' to most recent; adding 'c' should evict 'b'
    expect(cache.get('a')).toBe('one')
    cache.set('c', 'three')
    expect(cache.get('b')).toBeUndefined()
    expect(cache.get('c')).toBe('three')
  })

  it('evicts LRU entry when at capacity', () => {
    const cache = new CompletionCache<number>(1)
    cache.set('x', 1)
    cache.set('y', 2)
    expect(cache.get('x')).toBeUndefined()
    expect(cache.get('y')).toBe(2)
  })

  it('updates existing key in place without growing', () => {
    const cache = new CompletionCache<string>(2)
    cache.set('k', 'v1')
    cache.set('k', 'v2')
    expect(cache.size).toBe(1)
    expect(cache.get('k')).toBe('v2')
  })

  it('clear resets the cache', () => {
    const cache = new CompletionCache<string>()
    cache.set('a', '1')
    cache.clear()
    expect(cache.size).toBe(0)
  })
})

describe('buildCacheKey', () => {
  it('returns formatted key', () => {
    expect(buildCacheKey('file:///a.st', 42, 'abc')).toBe('file:///a.st:42:abc')
  })
})

describe('hashString', () => {
  it('returns a consistent base-36 string', () => {
    const h = hashString('hello')
    expect(typeof h).toBe('string')
    expect(h).toBe(hashString('hello'))
  })

  it('returns different hashes for different inputs', () => {
    expect(hashString('a')).not.toBe(hashString('b'))
  })
})
