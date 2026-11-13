/**
 * @jest-environment node
 */
import { generateKeyPairSync, type KeyObject, sign } from 'node:crypto'

import type { RawHttpReply, RuntimeLicenseMechanisms } from '../../../ports/runtime-license-mechanisms'
import { canonicalRuntimeLicensePayload } from '../runtime-license-file'
import { RUNTIME_LICENSE_PRODUCT_ID } from '../runtime-license-keys'
import {
  lookupRuntimeLicenses,
  MAX_RUNTIME_LICENSE_BYTES,
  readRuntimeHardwareId,
  readRuntimeLicenseReport,
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

const envelope = (licenses: unknown[]) => ({ statusCode: 200, data: { hardwareId: ID, seats: 2, licenses } })

type Handler = (path: string, json?: unknown) => Promise<RawHttpReply>

/** In-memory mechanisms recording every call; each handler answers its kind. */
function mechanisms(handlers: { runtimeGet?: Handler; runtimePost?: Handler; edgePost?: Handler } = {}) {
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
    await expect(readRuntimeHardwareId(text.m)).resolves.toEqual({ success: true, hardwareId: ID, source: 'device' })
    expect(text.calls).toEqual([{ kind: 'runtimeGet', path: '/api/hardware-id' }])

    const parsed = mechanisms({
      runtimeGet: async () => ({ status: 200, body: { hardwareId: ID, source: 'orchestrator' } }),
    })
    await expect(readRuntimeHardwareId(parsed.m)).resolves.toEqual({
      success: true,
      hardwareId: ID,
      source: 'orchestrator',
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

/** A runtime that stores what it is given and reports it, plus an Edge that returns `edge`. */
function fakeTarget(opts: { stored?: unknown[]; edge?: unknown[]; hardwareId?: string | null; storeOnPost?: boolean }) {
  const stored = [...(opts.stored ?? [])]
  const hardwareId = opts.hardwareId === undefined ? ID : opts.hardwareId
  return {
    stored,
    ...mechanisms({
      runtimeGet: async () => ({ status: 200, body: { hardwareId, source: 'device', licenses: stored } }),
      runtimePost: async (_path, json) => {
        if (opts.storeOnPost !== false) stored.push(json)
        return { status: 200, body: { orderId: (json as { order_id: string }).order_id } }
      },
      edgePost: async () => ({ status: 200, body: envelope(opts.edge ?? []) }),
    }),
  }
}

describe('readRuntimeLicenseReport', () => {
  it('reads the hardware ID and the licences as stored', async () => {
    const { m, calls } = fakeTarget({ stored: [licence()] })
    await expect(readRuntimeLicenseReport(m)).resolves.toEqual({
      ok: true,
      report: { hardwareId: ID, licenses: [licence()] },
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
  it('is commercial from a valid stored licence without asking Edge', async () => {
    const { m, calls } = fakeTarget({ stored: [licence({ sig: 'x' }), signed()] })
    await expect(syncRuntimeLicenses(m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'commercial',
      uploads: [],
    })
    expect(calls.map((c) => c.kind)).toEqual(['runtimeGet'])
  })

  it('uploads only the Edge licences that verify, then reads the runtime again', async () => {
    const good = signed({ order_id: 'order_good' })
    const forged = signed({ order_id: 'order_forged', seats: 1000 }, forger.privateKey)
    const target = fakeTarget({ edge: [forged, good] })
    await expect(syncRuntimeLicenses(target.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'commercial',
      uploads: [
        { orderId: 'order_forged', stored: false, error: 'its signature is not accepted' },
        { orderId: 'order_good', stored: true },
      ],
    })
    expect(target.stored).toEqual([good])
    expect(target.calls.map((c) => c.kind)).toEqual(['runtimeGet', 'edgePost', 'runtimePost', 'runtimeGet'])
  })

  it('is GPLv3 for stored licences that do not verify: forged, edited, another device or product', async () => {
    const stored = [
      signed({}, forger.privateKey),
      { ...signed(), seats: 50 },
      signed({ hardware_id: OTHER_ID }),
      { ...signed(), product: 'com.autonomy.openplc-runtime-baremetal' },
      signed({ key_id: 3 }),
    ]
    const { m } = fakeTarget({ stored })
    await expect(syncRuntimeLicenses(m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'gpl',
      uploads: [],
    })
  })

  it('stays GPLv3 when the upload is stored but the runtime does not report it (vPLC without a seat)', async () => {
    const { m } = fakeTarget({ edge: [signed()], storeOnPost: false })
    await expect(syncRuntimeLicenses(m, KEYS)).resolves.toMatchObject({
      status: 'synced',
      license: 'gpl',
      uploads: [{ orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', stored: true }],
    })
  })

  it('is GPLv3 with the reason when Edge cannot be reached, and uploads nothing', async () => {
    const target = fakeTarget({})
    const offline = mechanisms({
      runtimeGet: target.m.runtimeGet,
      edgePost: () => Promise.reject(new Error('offline')),
    })
    await expect(syncRuntimeLicenses(offline.m, KEYS)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      license: 'gpl',
      uploads: [],
      detail: 'offline',
    })
    expect(offline.calls.some((c) => c.kind === 'runtimePost')).toBe(false)
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
    })
  })
})
