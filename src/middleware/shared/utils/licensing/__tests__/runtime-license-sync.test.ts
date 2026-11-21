/**
 * @jest-environment node
 */
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

import type { RawHttpReply, RuntimeLicenseMechanisms } from '../../../ports/runtime-license-mechanisms'
import { canonicalRuntimeLicensePayload } from '../runtime-license-file'
import { RUNTIME_LICENSE_PRODUCT_ID } from '../runtime-license-keys'
import {
  classifyPublicRuntimeLicense,
  lookupRuntimeLicenses,
  MAX_RUNTIME_LICENSE_BYTES,
  readRuntimeHardwareId,
  readRuntimeLicenseReport,
  RUNTIME_LICENSE_LOOKUP_TIMEOUT_MS,
  selectRuntimeLicenseFiles,
  syncRuntimeLicenses,
} from '../runtime-license-sync'

const ID = `hw2:${'ab'.repeat(32)}`
const OTHER_ID = `hw2:${'cd'.repeat(32)}`

function licence(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    fmt: 1,
    product: RUNTIME_LICENSE_PRODUCT_ID,
    hardware_id: ID,
    seats: 2,
    order_id: 'cmv0a1b2c3d4e5f6g7h8i9j0',
    issued_at: '2026-10-28T12:00:00Z',
    key_id: 0,
    sig: 'c2ln',
    ...overrides,
  }
}

const ELEMENTS = [
  { kind: 'machine_id', hash: '11'.repeat(32) },
  { kind: 'instance', hash: '22'.repeat(32) },
]

const envelope = (licenses: unknown[]) => ({ statusCode: 200, data: { hardwareId: ID, seats: 2, licenses } })

type Handler = (path: string, json?: unknown) => Promise<RawHttpReply>

/** In-memory mechanisms recording every call; each handler answers its kind. */
function mechanisms(
  handlers: { runtimeGet?: Handler; runtimePost?: Handler; runtimeDelete?: Handler; edgePost?: Handler } = {},
) {
  const calls: { kind: string; path: string; json?: unknown }[] = []
  const record =
    (kind: string, handler: Handler | undefined, fallback: RawHttpReply): Handler =>
    async (path, json) => {
      calls.push({ kind, path, ...(json === undefined ? {} : { json }) })
      return handler ? handler(path, json) : fallback
    }
  const m: RuntimeLicenseMechanisms = {
    runtimeGet: record('runtimeGet', handlers.runtimeGet, {
      status: 200,
      body: JSON.stringify({ hardwareId: ID, source: 'device', elements: [] }),
    }),
    runtimePost: record('runtimePost', handlers.runtimePost, { status: 200, body: '{"license":"commercial"}' }),
    runtimeDelete: record('runtimeDelete', handlers.runtimeDelete, { status: 200, body: '{"removed":true}' }),
    edgePost: record('edgePost', handlers.edgePost, { status: 200, body: JSON.stringify(envelope([licence()])) }),
  }
  return { m, calls }
}

describe('selectRuntimeLicenseFiles', () => {
  it('keeps licences for this product and hardware ID, unchanged', () => {
    expect(selectRuntimeLicenseFiles(envelope([licence()]), ID)).toEqual([
      { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', license: licence() },
    ])
  })

  it('drops licences for another product, another ID, or a bad order ID', () => {
    const files = selectRuntimeLicenseFiles(
      envelope([
        licence({ product: 'com.openplc.espressif-licensed' }),
        licence({ hardware_id: OTHER_ID }),
        licence({ order_id: '../escape' }),
        licence({ order_id: 'x'.repeat(65) }),
        licence({ order_id: 12 }),
        'not an object',
        null,
        [licence()],
      ]),
      ID,
    )
    expect(files).toEqual([])
  })

  it('drops a licence larger than the runtime accepts', () => {
    const big = licence({ sig: 'a'.repeat(MAX_RUNTIME_LICENSE_BYTES) })
    expect(selectRuntimeLicenseFiles(envelope([big]), ID)).toEqual([])
  })

  it('reads an unwrapped body and tolerates junk', () => {
    expect(selectRuntimeLicenseFiles({ licenses: [licence()] }, ID)).toHaveLength(1)
    expect(selectRuntimeLicenseFiles({ statusCode: 200, data: { licenses: 'x' } }, ID)).toEqual([])
    expect(selectRuntimeLicenseFiles(null, ID)).toEqual([])
  })
})

describe('readRuntimeHardwareId', () => {
  it('reads the ID from a text or an already-parsed body', async () => {
    const text = mechanisms()
    await expect(readRuntimeHardwareId(text.m)).resolves.toEqual({
      success: true,
      hardwareId: ID,
      source: 'device',
      elements: [],
    })
    expect(text.calls).toEqual([{ kind: 'runtimeGet', path: '/api/hardware-id' }])

    const parsed = mechanisms({
      runtimeGet: async () => ({ status: 200, body: { hardwareId: ID, elements: ELEMENTS } }),
    })
    await expect(readRuntimeHardwareId(parsed.m)).resolves.toEqual({
      success: true,
      hardwareId: ID,
      source: null,
      elements: ELEMENTS,
    })
  })

  it('reports an HTTP failure, a malformed body and a transport failure', async () => {
    const missing = mechanisms({ runtimeGet: async () => ({ status: 404, body: 'Not Found' }) })
    await expect(readRuntimeHardwareId(missing.m)).resolves.toEqual({
      success: false,
      error: 'Get hardware ID failed: 404',
    })

    const junk = mechanisms({ runtimeGet: async () => ({ status: 200, body: '{"hardwareId":"hw2:../x"}' }) })
    await expect(readRuntimeHardwareId(junk.m)).resolves.toEqual({
      success: false,
      error: 'The runtime sent a hardware ID the editor could not read.',
    })

    const down = mechanisms({ runtimeGet: () => Promise.reject(new Error('Connection timeout')) })
    await expect(readRuntimeHardwareId(down.m)).resolves.toEqual({ success: false, error: 'Connection timeout' })
  })
})

describe('lookupRuntimeLicenses', () => {
  it('posts the hardware ID to the lookup and returns the matching files', async () => {
    const { m, calls } = mechanisms()
    await expect(lookupRuntimeLicenses(m, ID)).resolves.toEqual({
      ok: true,
      licenses: [{ orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', license: licence() }],
    })
    expect(calls).toEqual([{ kind: 'edgePost', path: '/runtime-licenses/lookup', json: { hardwareId: ID } }])
  })

  it('reports a refused lookup (rate limit) and a transport failure', async () => {
    const limited = mechanisms({ edgePost: async () => ({ status: 429, body: '{"statusCode":429}' }) })
    await expect(lookupRuntimeLicenses(limited.m, ID)).resolves.toEqual({
      ok: false,
      error: 'The licence server refused the lookup (HTTP 429).',
    })

    const offline = mechanisms({ edgePost: () => Promise.reject(new Error('getaddrinfo ENOTFOUND')) })
    await expect(lookupRuntimeLicenses(offline.m, ID)).resolves.toEqual({ ok: false, error: 'getaddrinfo ENOTFOUND' })
  })

  it('reports a 2xx answer without a licence list as a failed lookup, not as no licences', async () => {
    for (const body of ['<html>portal</html>', { statusCode: 200, data: { hardwareId: ID } }, { licences: [] }]) {
      const odd = mechanisms({ edgePost: async () => ({ status: 200, body }) })
      await expect(lookupRuntimeLicenses(odd.m, ID)).resolves.toEqual({
        ok: false,
        error: 'The licence server sent a lookup answer the editor could not read.',
      })
    }
    const empty = mechanisms({ edgePost: async () => ({ status: 200, body: envelope([]) }) })
    await expect(lookupRuntimeLicenses(empty.m, ID)).resolves.toEqual({ ok: true, licenses: [] })
  })

  it('never sends a malformed ID', async () => {
    const { m, calls } = mechanisms()
    await expect(lookupRuntimeLicenses(m, 'hw2:nope')).resolves.toEqual({ ok: false, error: 'Not a hardware ID.' })
    expect(calls).toEqual([])
  })
})

function rawPublicKeyHex(publicKey: KeyObject): string {
  const jwk = publicKey.export({ format: 'jwk' })
  const hex = (b64: string | undefined) => Buffer.from(b64 ?? '', 'base64url').toString('hex')
  return hex(jwk.x) + hex(jwk.y)
}

const signer = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const forger = generateKeyPairSync('ec', { namedCurve: 'P-256' })
const KEYS = { 0: rawPublicKeyHex(signer.publicKey) }

/** A licence file as Edge issues it, signed with `key`. */
function signed(overrides: Record<string, unknown> = {}, key: KeyObject = signer.privateKey): Record<string, unknown> {
  const payload = { ...licence(overrides) }
  delete payload.sig
  const sig = sign('sha256', canonicalRuntimeLicensePayload(payload), { key, dsaEncoding: 'ieee-p1363' })
  return { ...payload, sig: sig.toString('base64') }
}

/** A single-slot runtime that stores what it is given and reports it, plus an Edge that returns `edge`. */
function fakeTarget(opts: {
  stored?: unknown[]
  edge?: unknown[]
  hardwareId?: string | null
  storeOnPost?: boolean
  edgeDown?: boolean
}) {
  const stored = [...(opts.stored ?? [])]
  const hardwareId = opts.hardwareId === undefined ? ID : opts.hardwareId
  return {
    stored,
    ...mechanisms({
      runtimeGet: async (path) =>
        path === '/api/hardware-id'
          ? { status: 200, body: { hardwareId, elements: ELEMENTS } }
          : { status: 200, body: { hardwareId, licenses: stored } },
      runtimePost: async (_path, json) => {
        if (opts.storeOnPost !== false) stored.splice(0, stored.length, json)
        return { status: 200, body: { orderId: (json as { order_id: string }).order_id } }
      },
      runtimeDelete: async () => {
        const removed = stored.length > 0
        stored.splice(0, stored.length)
        return { status: 200, body: { removed } }
      },
      edgePost: async () => {
        if (opts.edgeDown) throw new Error('offline')
        return { status: 200, body: envelope(opts.edge ?? []) }
      },
    }),
  }
}

describe('readRuntimeLicenseReport', () => {
  it('reads the hardware ID and the licences as stored', async () => {
    const { m, calls } = fakeTarget({ stored: [licence()] })
    await expect(readRuntimeLicenseReport(m)).resolves.toEqual({
      ok: true,
      report: { hardwareId: ID, source: null, licenses: [licence()] },
    })
    expect(calls).toEqual([{ kind: 'runtimeGet', path: '/api/runtime-license' }])
  })

  it('reports an older runtime without the endpoint, a malformed body and a transport failure', async () => {
    const old = mechanisms({ runtimeGet: async () => ({ status: 405, body: '' }) })
    await expect(readRuntimeLicenseReport(old.m)).resolves.toEqual({
      ok: false,
      error: 'Get runtime licenses failed: 405',
    })
    const junk = mechanisms({ runtimeGet: async () => ({ status: 200, body: { hardwareId: ID } }) })
    await expect(readRuntimeLicenseReport(junk.m)).resolves.toMatchObject({ ok: false })
    const down = mechanisms({ runtimeGet: () => Promise.reject(new Error('Connection timeout')) })
    await expect(readRuntimeLicenseReport(down.m)).resolves.toEqual({ ok: false, error: 'Connection timeout' })
  })
})

describe('syncRuntimeLicenses', () => {
  const kinds = (calls: { kind: string; path: string }[]) => calls.map((c) => `${c.kind} ${c.path}`)

  it('is commercial when the stored licence verifies and Edge lists it as active, and keeps the elements', async () => {
    const good = signed()
    const { m, calls, stored } = fakeTarget({ stored: [good], edge: [good] })
    await expect(syncRuntimeLicenses(m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'commercial',
      uploads: [],
      elements: ELEMENTS,
    })
    expect(stored).toEqual([good])
    expect(kinds(calls)).toEqual([
      'runtimeGet /api/runtime-license',
      'runtimeGet /api/hardware-id',
      'edgePost /runtime-licenses/lookup',
    ])
  })

  it('removes a stored licence Edge no longer lists (revoked) and reports GPLv3', async () => {
    const target = fakeTarget({ stored: [signed()], edge: [] })
    await expect(syncRuntimeLicenses(target.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'gpl',
      uploads: [],
      elements: ELEMENTS,
      revoked: { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', removed: true },
    })
    expect(target.stored).toEqual([])
    expect(target.calls.map((c) => c.kind)).toContain('runtimeDelete')
  })

  it('reports a removal the runtime refused', async () => {
    const target = fakeTarget({ stored: [signed()], edge: [] })
    const refusing = mechanisms({
      runtimeGet: target.m.runtimeGet,
      edgePost: (path, json) => target.m.edgePost(path, json as Record<string, unknown>),
      runtimeDelete: async () => ({ status: 405, body: '' }),
    })
    await expect(syncRuntimeLicenses(refusing.m, KEYS)).resolves.toMatchObject({
      license: 'gpl',
      revoked: { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', removed: false, error: 'HTTP 405' },
    })
  })

  it('replaces a revoked licence with another active one', async () => {
    const replacement = signed({ order_id: 'order_new' })
    const target = fakeTarget({ stored: [signed()], edge: [replacement] })
    await expect(syncRuntimeLicenses(target.m, KEYS)).resolves.toMatchObject({
      license: 'commercial',
      uploads: [{ orderId: 'order_new', stored: true }],
      revoked: { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', removed: true },
    })
    expect(target.stored).toEqual([replacement])
  })

  it('keeps the offline verdict when Edge cannot be reached', async () => {
    const licensed = fakeTarget({ stored: [signed()], edgeDown: true })
    await expect(syncRuntimeLicenses(licensed.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'commercial',
      uploads: [],
      elements: ELEMENTS,
    })
    expect(licensed.stored).toHaveLength(1)

    const unlicensed = fakeTarget({ edgeDown: true })
    await expect(syncRuntimeLicenses(unlicensed.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'gpl',
      uploads: [],
      elements: ELEMENTS,
      detail: 'offline',
    })
    expect(unlicensed.calls.some((c) => c.kind === 'runtimePost' || c.kind === 'runtimeDelete')).toBe(false)
  })

  it('keeps the offline verdict when the lookup times out', async () => {
    const target = fakeTarget({ stored: [signed()] })
    const slow = mechanisms({
      runtimeGet: target.m.runtimeGet,
      edgePost: () => new Promise<RawHttpReply>(() => undefined),
    })
    await expect(syncRuntimeLicenses(slow.m, KEYS, 10)).resolves.toMatchObject({
      license: 'commercial',
      uploads: [],
    })
    expect(slow.calls.some((c) => c.kind === 'runtimeDelete')).toBe(false)
  })

  it('keeps the stored licence when the lookup fails or its answer cannot be read', async () => {
    for (const edge of [
      async () => ({ status: 500, body: '{"statusCode":500}' }),
      async () => ({ status: 429, body: '{"statusCode":429}' }),
      async () => ({ status: 200, body: '<html>portal</html>' }),
    ]) {
      const target = fakeTarget({ stored: [signed()] })
      const failing = mechanisms({ runtimeGet: target.m.runtimeGet, edgePost: edge })
      await expect(syncRuntimeLicenses(failing.m, KEYS)).resolves.toEqual({
        status: 'synced',
        hardwareId: ID,
        license: 'commercial',
        uploads: [],
        elements: ELEMENTS,
      })
      expect(failing.calls.some((c) => c.kind === 'runtimeDelete' || c.kind === 'runtimePost')).toBe(false)
    }
  })

  it('keeps GPLv3 with the reason when the lookup fails for a runtime without a licence', async () => {
    const target = fakeTarget({})
    const failing = mechanisms({
      runtimeGet: target.m.runtimeGet,
      edgePost: async () => ({ status: 503, body: '' }),
    })
    await expect(syncRuntimeLicenses(failing.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'gpl',
      uploads: [],
      elements: ELEMENTS,
      detail: 'The licence server refused the lookup (HTTP 503).',
    })
  })

  it('answers within the timeout when Edge never answers, keeping a missing licence GPLv3', async () => {
    const target = fakeTarget({})
    const silent = mechanisms({
      runtimeGet: target.m.runtimeGet,
      edgePost: () => new Promise<RawHttpReply>(() => undefined),
    })
    const started = Date.now()
    await expect(syncRuntimeLicenses(silent.m, KEYS, 50)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'gpl',
      uploads: [],
      elements: ELEMENTS,
      detail: 'The licence server did not answer in time.',
    })
    const elapsed = Date.now() - started
    expect(elapsed).toBeGreaterThanOrEqual(45)
    expect(elapsed).toBeLessThan(1000)
  })

  it('does not wait for the timeout when Edge is unreachable', async () => {
    const target = fakeTarget({ stored: [signed()], edgeDown: true })
    const started = Date.now()
    await expect(syncRuntimeLicenses(target.m, KEYS, 10_000)).resolves.toMatchObject({ license: 'commercial' })
    expect(Date.now() - started).toBeLessThan(1000)
    expect(target.stored).toHaveLength(1)
  })

  it('bounds the lookup by a 2 s timeout by default and clears it once Edge answers', async () => {
    expect(RUNTIME_LICENSE_LOOKUP_TIMEOUT_MS).toBe(2000)
    const setSpy = vi.spyOn(globalThis, 'setTimeout')
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const good = signed()
      const target = fakeTarget({ stored: [good], edge: [good] })
      await expect(syncRuntimeLicenses(target.m, KEYS)).resolves.toMatchObject({ license: 'commercial' })
      const index = (setSpy.mock.calls as unknown[][]).findIndex((call) => call[1] === 2000)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(clearSpy).toHaveBeenCalledWith((setSpy.mock.results as { value: unknown }[])[index]?.value)
    } finally {
      setSpy.mockRestore()
      clearSpy.mockRestore()
    }
  })

  it('uploads the first Edge licence that verifies, then reads the runtime again', async () => {
    const good = signed({ order_id: 'order_good' })
    const other = signed({ order_id: 'order_other' })
    const forged = signed({ order_id: 'order_forged', seats: 1000 }, forger.privateKey)
    const target = fakeTarget({ edge: [forged, good, other] })
    await expect(syncRuntimeLicenses(target.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'commercial',
      uploads: [
        { orderId: 'order_forged', stored: false, error: 'its signature is not accepted' },
        { orderId: 'order_good', stored: true },
      ],
      elements: ELEMENTS,
    })
    expect(target.stored).toEqual([good])
    expect(target.calls.map((c) => c.kind)).toEqual([
      'runtimeGet',
      'runtimeGet',
      'edgePost',
      'runtimePost',
      'runtimeGet',
    ])
  })

  it('replaces stored licences that do not verify: forged, edited, another device or product', async () => {
    for (const bad of [
      signed({}, forger.privateKey),
      { ...signed(), seats: 50 },
      signed({ hardware_id: OTHER_ID }),
      { ...signed(), product: 'com.autonomy.openplc-runtime-baremetal' },
      signed({ key_id: 3 }),
    ]) {
      const none = fakeTarget({ stored: [bad] })
      await expect(syncRuntimeLicenses(none.m, KEYS)).resolves.toMatchObject({ license: 'gpl', uploads: [] })
      expect(none.calls.some((c) => c.kind === 'runtimeDelete')).toBe(false)

      const good = signed()
      const fixed = fakeTarget({ stored: [bad], edge: [good] })
      await expect(syncRuntimeLicenses(fixed.m, KEYS)).resolves.toMatchObject({ license: 'commercial' })
      expect(fixed.stored).toEqual([good])
    }
  })

  it('stays GPLv3 when the upload is not reported back', async () => {
    const target = fakeTarget({ edge: [signed()], storeOnPost: false })
    await expect(syncRuntimeLicenses(target.m, KEYS)).resolves.toMatchObject({
      status: 'synced',
      license: 'gpl',
      uploads: [{ orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', stored: true }],
    })
  })

  it('sends no elements when the hardware ID endpoint fails or reports another ID', async () => {
    const target = fakeTarget({ stored: [signed()], edge: [signed()] })
    const noElements = mechanisms({
      runtimeGet: async (path) => (path === '/api/hardware-id' ? { status: 401, body: '' } : target.m.runtimeGet(path)),
      edgePost: (path, json) => target.m.edgePost(path, json as Record<string, unknown>),
    })
    await expect(syncRuntimeLicenses(noElements.m, KEYS)).resolves.toMatchObject({ elements: [] })

    const otherId = mechanisms({
      runtimeGet: async (path) =>
        path === '/api/hardware-id'
          ? { status: 200, body: { hardwareId: OTHER_ID, elements: ELEMENTS } }
          : target.m.runtimeGet(path),
      edgePost: (path, json) => target.m.edgePost(path, json as Record<string, unknown>),
    })
    await expect(syncRuntimeLicenses(otherId.m, KEYS)).resolves.toMatchObject({ elements: [] })
  })

  it('gives no status when the runtime cannot be read back after an upload', async () => {
    const target = fakeTarget({ edge: [signed()] })
    let reads = 0
    const flaky = mechanisms({
      runtimeGet: async (path) =>
        path === '/api/hardware-id' || ++reads === 1 ? target.m.runtimeGet(path) : { status: 503, body: '' },
      edgePost: (path, json) => target.m.edgePost(path, json as Record<string, unknown>),
      runtimePost: (path, json) => target.m.runtimePost(path, json as Record<string, unknown>),
    })
    await expect(syncRuntimeLicenses(flaky.m, KEYS)).resolves.toEqual({
      status: 'failed',
      error: 'License uploaded, but the runtime could not be read back: Get runtime licenses failed: 503',
    })
  })

  it('reports no hardware ID, and a failed first read', async () => {
    const none = fakeTarget({ hardwareId: null })
    await expect(syncRuntimeLicenses(none.m, KEYS)).resolves.toEqual({ status: 'no-hardware-id' })
    expect(none.calls.map((c) => c.kind)).toEqual(['runtimeGet'])

    const old = mechanisms({ runtimeGet: async () => ({ status: 404, body: '' }) })
    await expect(syncRuntimeLicenses(old.m, KEYS)).resolves.toEqual({
      status: 'failed',
      error: 'Get runtime licenses failed: 404',
    })
  })

  it('records a refused or failed upload and keeps going', async () => {
    let first = true
    const target = fakeTarget({ edge: [signed(), signed({ order_id: 'order_2' })] })
    const flaky = mechanisms({
      runtimeGet: target.m.runtimeGet,
      edgePost: (path, json) => target.m.edgePost(path, json as Record<string, unknown>),
      runtimePost: async (path, json) => {
        if (!first) return target.m.runtimePost(path, json as Record<string, unknown>)
        first = false
        throw new Error('socket hang up')
      },
    })
    await expect(syncRuntimeLicenses(flaky.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'commercial',
      uploads: [
        { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', stored: false, error: 'socket hang up' },
        { orderId: 'order_2', stored: true },
      ],
      elements: ELEMENTS,
    })
  })
})

describe('classifyPublicRuntimeLicense', () => {
  it('is MIT for a runtime without the public endpoint', async () => {
    await expect(classifyPublicRuntimeLicense({ status: 401, body: '' }, KEYS)).resolves.toBe('mit')
  })

  it('is commercial only for a licence that verifies for the reported ID', async () => {
    const body = (licenses: unknown[]) => ({ status: 200, body: JSON.stringify({ hardwareId: ID, licenses }) })
    await expect(classifyPublicRuntimeLicense(body([signed()]), KEYS)).resolves.toBe('commercial')
    await expect(classifyPublicRuntimeLicense(body([]), KEYS)).resolves.toBe('gpl')
    await expect(classifyPublicRuntimeLicense(body([signed({}, forger.privateKey)]), KEYS)).resolves.toBe('gpl')
    await expect(classifyPublicRuntimeLicense(body([signed({ hardware_id: OTHER_ID })]), KEYS)).resolves.toBe('gpl')
  })

  it('is unknown for a failure or a body it cannot read', async () => {
    await expect(classifyPublicRuntimeLicense({ status: 502, body: '' }, KEYS)).resolves.toBe('unknown')
    await expect(classifyPublicRuntimeLicense({ status: 200, body: 'junk' }, KEYS)).resolves.toBe('unknown')
    await expect(
      classifyPublicRuntimeLicense({ status: 200, body: { hardwareId: null, licenses: [] } }, KEYS),
    ).resolves.toBe('unknown')
  })
})
