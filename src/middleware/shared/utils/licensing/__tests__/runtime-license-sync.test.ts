import type { RawHttpReply, RuntimeLicenseMechanisms } from '../../../ports/runtime-license-mechanisms'
import {
  lookupRuntimeLicenses,
  MAX_RUNTIME_LICENSE_BYTES,
  readRuntimeHardwareId,
  RUNTIME_LICENSE_PRODUCT_ID,
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

describe('syncRuntimeLicenses', () => {
  const second = licence({ order_id: 'order_2' })

  it('uploads every licence Edge returns for the runtime ID, unchanged', async () => {
    const { m, calls } = mechanisms({
      edgePost: async () => ({ status: 200, body: envelope([licence(), second]) }),
      runtimePost: async (_path, json) =>
        (json as { order_id: string }).order_id === 'order_2'
          ? { status: 400, body: '{"error":"Licence is for another hardware ID"}' }
          : { status: 200, body: '{"license":"commercial"}' },
    })
    await expect(syncRuntimeLicenses(m)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      uploads: [
        { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', stored: true },
        { orderId: 'order_2', stored: false, error: 'Licence is for another hardware ID' },
      ],
    })
    expect(calls.filter((c) => c.kind === 'runtimePost')).toEqual([
      { kind: 'runtimePost', path: '/api/runtime-license', json: licence() },
      { kind: 'runtimePost', path: '/api/runtime-license', json: second },
    ])
  })

  it('does nothing past the runtime when it has no hardware ID', async () => {
    const { m, calls } = mechanisms({
      runtimeGet: async () => ({ status: 200, body: '{"hardwareId":null,"source":null,"elements":[]}' }),
    })
    await expect(syncRuntimeLicenses(m)).resolves.toEqual({ status: 'no-hardware-id' })
    expect(calls.map((c) => c.kind)).toEqual(['runtimeGet'])
  })

  it('reports a failed hardware ID read or lookup and uploads nothing', async () => {
    const noId = mechanisms({ runtimeGet: async () => ({ status: 404, body: '' }) })
    await expect(syncRuntimeLicenses(noId.m)).resolves.toEqual({
      status: 'failed',
      error: 'Get hardware ID failed: 404',
    })

    const offline = mechanisms({ edgePost: () => Promise.reject(new Error('offline')) })
    await expect(syncRuntimeLicenses(offline.m)).resolves.toEqual({ status: 'failed', error: 'offline' })
    expect(offline.calls.some((c) => c.kind === 'runtimePost')).toBe(false)
  })

  it('records a transport failure on one upload and keeps going', async () => {
    let first = true
    const { m } = mechanisms({
      edgePost: async () => ({ status: 200, body: envelope([licence(), second]) }),
      runtimePost: async () => {
        if (!first) return { status: 200, body: '{}' }
        first = false
        throw new Error('socket hang up')
      },
    })
    await expect(syncRuntimeLicenses(m)).resolves.toEqual({
      status: 'synced',
      hardwareId: ID,
      uploads: [
        { orderId: 'cmv0a1b2c3d4e5f6g7h8i9j0', stored: false, error: 'socket hang up' },
        { orderId: 'order_2', stored: true },
      ],
    })
  })
})
