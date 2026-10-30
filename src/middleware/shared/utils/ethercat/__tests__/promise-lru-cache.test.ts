import { createPromiseLruCache } from '../promise-lru-cache'

function deferred<T>() {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createPromiseLruCache', () => {
  const byLength = { maxWeight: 10, weigh: (v: string) => v.length }

  it('runs the loader once and serves later loads from the cache', async () => {
    const cache = createPromiseLruCache(byLength)
    const loader = vi.fn(() => Promise.resolve('abc'))

    await expect(cache.load('a', loader)).resolves.toBe('abc')
    await expect(cache.load('a', loader)).resolves.toBe('abc')

    expect(loader).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it('shares one in-flight load between concurrent callers', async () => {
    const cache = createPromiseLruCache(byLength)
    const d = deferred<string>()
    const loader = vi.fn(() => d.promise)

    const first = cache.load('a', loader)
    const second = cache.load('a', loader)
    d.resolve('abc')

    await expect(Promise.all([first, second])).resolves.toEqual(['abc', 'abc'])
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('does not keep a rejection, so the next load retries', async () => {
    const cache = createPromiseLruCache(byLength)
    const loader = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce('ok')

    await expect(cache.load('a', loader)).rejects.toThrow('boom')
    await expect(cache.load('a', loader)).resolves.toBe('ok')

    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('evicts the least recently used entries once the weight bound is exceeded', async () => {
    const cache = createPromiseLruCache(byLength)
    await cache.load('a', () => Promise.resolve('aaaa'))
    await cache.load('b', () => Promise.resolve('bbbb'))
    // Touch "a" so "b" becomes the least recently used.
    await cache.load('a', () => Promise.resolve('unused'))
    await cache.load('c', () => Promise.resolve('cccc'))

    const reload = vi.fn(() => Promise.resolve('fresh'))
    await cache.load('a', reload)
    expect(reload).not.toHaveBeenCalled()
    await cache.load('b', reload)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('keeps the newest entry even when it alone exceeds the bound', async () => {
    const cache = createPromiseLruCache(byLength)
    await cache.load('a', () => Promise.resolve('aa'))
    await cache.load('big', () => Promise.resolve('x'.repeat(50)))

    expect(cache.size).toBe(1)
    const reload = vi.fn(() => Promise.resolve('unused'))
    await expect(cache.load('big', reload)).resolves.toHaveLength(50)
    expect(reload).not.toHaveBeenCalled()
  })

  it('delete drops a stored entry', async () => {
    const cache = createPromiseLruCache(byLength)
    await cache.load('a', () => Promise.resolve('abc'))
    cache.delete('a')

    const loader = vi.fn(() => Promise.resolve('new'))
    await expect(cache.load('a', loader)).resolves.toBe('new')
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('a delete during an in-flight load keeps its result out of the cache', async () => {
    const cache = createPromiseLruCache(byLength)
    const d = deferred<string>()
    const pending = cache.load('a', () => d.promise)
    cache.delete('a')
    d.resolve('stale')

    await expect(pending).resolves.toBe('stale')
    expect(cache.size).toBe(0)
  })

  it('a rejection after a delete does not disturb a newer in-flight load', async () => {
    const cache = createPromiseLruCache(byLength)
    const old = deferred<string>()
    const oldLoad = cache.load('a', () => old.promise)
    cache.delete('a')
    const fresh = deferred<string>()
    const freshLoader = vi.fn(() => fresh.promise)
    const freshLoad = cache.load('a', freshLoader)

    old.reject(new Error('old'))
    await expect(oldLoad).rejects.toThrow('old')
    // Still shares the newer in-flight promise instead of starting another load.
    const again = cache.load('a', freshLoader)
    fresh.resolve('new')

    await expect(Promise.all([freshLoad, again])).resolves.toEqual(['new', 'new'])
    expect(freshLoader).toHaveBeenCalledTimes(1)
    expect(cache.size).toBe(1)
  })

  it('deleteWhere drops stored and in-flight entries matching the predicate', async () => {
    const cache = createPromiseLruCache(byLength)
    await cache.load('x:1', () => Promise.resolve('a'))
    await cache.load('y:1', () => Promise.resolve('b'))
    const d = deferred<string>()
    const pending = cache.load('x:2', () => d.promise)

    cache.deleteWhere((key) => key.startsWith('x:'))
    d.resolve('c')
    await pending

    expect(cache.size).toBe(1)
    const loader = vi.fn(() => Promise.resolve('again'))
    await cache.load('x:1', loader)
    await cache.load('y:1', loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('clear drops every entry', async () => {
    const cache = createPromiseLruCache(byLength)
    await cache.load('a', () => Promise.resolve('a'))
    await cache.load('b', () => Promise.resolve('b'))
    cache.clear()

    expect(cache.size).toBe(0)
    const loader = vi.fn(() => Promise.resolve('z'))
    await cache.load('a', loader)
    expect(loader).toHaveBeenCalledTimes(1)
  })
})
