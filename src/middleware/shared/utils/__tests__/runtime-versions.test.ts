/**
 * The version list (RTOP-283).
 *
 * This module had no test at all: the dialog's test mocks it with pre-sorted
 * tags, so the sort, the release filter, the pre-release ordering, the 403
 * handling and the cache all ran under nothing. The one property anybody
 * actually quoted -- that v4.1.10 sorts above v4.1.9 -- was never exercised.
 */

import { clearRuntimeVersionsCache, listRuntimeVersions } from '../runtime-versions'

const tags = (...names: unknown[]) => names.map((name) => ({ name }))

/**
 * `vi.stubGlobal` has no Jest equivalent, so fetch is replaced directly and
 * restored between tests. Same coverage as the web copy, different runner --
 * the two apps share this module but not a test framework.
 */
type FetchLike = typeof globalThis.fetch

const stubFetch = (impl: FetchLike): void => {
  globalThis.fetch = impl
}

const respondWith = (body: unknown, status = 200) =>
  jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  })

const realFetch = globalThis.fetch

beforeEach(() => {
  clearRuntimeVersionsCache()
  jest.restoreAllMocks()
})

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('listRuntimeVersions', () => {
  it('sorts numerically, so v4.1.10 comes above v4.1.9', async () => {
    // The whole reason this is not a string sort: lexicographically v4.1.10
    // falls below v4.1.9 and the newest patch release ends up buried.
    stubFetch(respondWith(tags('v4.1.9', 'v4.1.10', 'v4.2.0')))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.versions.map((v) => v.tag)).toEqual(['v4.2.0', 'v4.1.10', 'v4.1.9'])
  })

  it('puts a release above its own pre-releases', async () => {
    stubFetch(respondWith(tags('v4.2.0-rc.1', 'v4.2.0', 'v4.2.0-rc.2')))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.versions.map((v) => v.tag)).toEqual(['v4.2.0', 'v4.2.0-rc.2', 'v4.2.0-rc.1'])
    expect(result.versions[0].prerelease).toBe(false)
    expect(result.versions[1].prerelease).toBe(true)
  })

  it('keeps only release tags', async () => {
    // A tag that is not a release has no published image behind it, so
    // offering it would produce a failed pull and a confusing message.
    stubFetch(respondWith(tags('v4.2.0', 'nightly', 'RTOP-283', 'v4', 'v4.2')))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.versions.map((v) => v.tag)).toEqual(['v4.2.0'])
  })

  it('survives a null entry instead of losing every tag', async () => {
    // The bug: the old code cast each entry and read `.name`, so one null
    // element threw, landed in the catch and was reported as "could not reach
    // GitHub" -- discarding all the valid tags with it.
    stubFetch(respondWith([null, { name: 'v4.2.0' }, 'v9', { nope: 1 }]))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.versions.map((v) => v.tag)).toEqual(['v4.2.0'])
  })

  it('names the rate limit rather than reporting a generic failure', async () => {
    stubFetch(respondWith({ message: 'rate limit exceeded' }, 403))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/rate-limit/i)
  })

  it('reports a non-array body rather than throwing', async () => {
    stubFetch(respondWith({ message: 'Not Found' }))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/unexpected shape/i)
  })

  it('reports no releases when nothing matches', async () => {
    stubFetch(respondWith(tags('nightly', 'main')))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/no runtime releases/i)
  })

  it('reports a host that never answers as a timeout', async () => {
    // A black-holed api.github.com -- filtered DNS, a captive portal -- used
    // to hang until the browser's TCP timeout, with the dialog's typed
    // fallback disabled the whole time. Asserted through the rejection the
    // abort produces rather than by driving the timer, which AbortSignal
    // .timeout does not take from fake timers.
    stubFetch(jest.fn().mockRejectedValue(new DOMException('signal timed out', 'TimeoutError')))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toMatch(/in time/i)
  })

  it('always arms a timeout, even with no caller signal', async () => {
    // The guarantee behind the test above: something has to abort the request
    // if GitHub never answers, and the caller does not always provide it.
    const fetchMock = respondWith(tags('v4.2.0'))
    stubFetch(fetchMock)

    await listRuntimeVersions()

    const init = fetchMock.mock.calls[0][1] as { signal?: AbortSignal }
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('does not re-fetch a list it already has', async () => {
    const fetchMock = respondWith(tags('v4.2.0'))
    stubFetch(fetchMock)

    await listRuntimeVersions()
    await listRuntimeVersions()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the cache is cleared, which is what Retry does', async () => {
    const fetchMock = respondWith(tags('v4.2.0'))
    stubFetch(fetchMock)

    await listRuntimeVersions()
    clearRuntimeVersionsCache()
    await listRuntimeVersions()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a cancelled fetch distinctly, so the dialog stays quiet', async () => {
    stubFetch(jest.fn().mockRejectedValue(new DOMException('aborted', 'AbortError')))

    const result = await listRuntimeVersions()

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBe('cancelled')
  })
})
