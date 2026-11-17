/** @jest-environment node */
import { createHmiPreviewSession } from '../preview-session'
import { parseHmiPreviewRequest } from '../preview-worker'
import { fakeHost, type TestWorker, testWorker } from './fixtures/support'

const start = { width: 16, height: 8, page: 2, design: true }
const surface = { width: 16, height: 8, scale: 1 }

describe('parseHmiPreviewRequest', () => {
  it('accepts each request a session sends', () => {
    const wasm = new Uint8Array([1])
    const requests = [
      { id: 1, type: 'load', wasm, width: 1, height: 2, page: 0, design: false },
      { id: 2, type: 'frame', timeMs: 5, surface },
      { id: 3, type: 'show', page: 1 },
      { id: 4, type: 'resize', width: 3, height: 4 },
      { id: 5, type: 'pointer', kind: 'move', x: 1.5, y: 2 },
      { id: 6, type: 'key', code: 13 },
      { id: 7, type: 'setNumber', screen: 0, setter: 1, value: 2 },
      { id: 8, type: 'setText', screen: 0, setter: 1, value: 'a' },
    ]
    for (const request of requests) expect(parseHmiPreviewRequest(request)).toEqual(request)
  })

  it('refuses anything else', () => {
    for (const value of [
      null,
      { type: 'frame' },
      { id: 1, type: 'load', wasm: [1], width: 1, height: 1, page: 0 },
      { id: 1, type: 'frame', timeMs: 0, surface: { width: 1 } },
      { id: 1, type: 'frame', timeMs: 0 },
      { id: 1, type: 'show', page: 'x' },
      { id: 1, type: 'resize', width: 1 },
      { id: 1, type: 'pointer', kind: 'click', x: 0, y: 0 },
      { id: 1, type: 'key', code: Number.NaN },
      { id: 1, type: 'setNumber', screen: 0, setter: 1 },
      { id: 1, type: 'setText', screen: 0, setter: 1, value: 3 },
      { id: 1, type: 'exit' },
    ])
      expect(parseHmiPreviewRequest(value)).toBeNull()
  })
})

describe('preview session', () => {
  it('runs a module in its Worker: frames, input and live edits', async () => {
    const session = createHmiPreviewSession(() => testWorker())
    await session.load(fakeHost(), start)
    const frame = await session.frame(0, surface)
    expect(frame).toMatchObject({ page: 2, status: 0, pixels: { y0: 0, rows: 8 } })
    expect(frame.bounds).toHaveLength(2)
    expect((await session.frame(50, surface)).pixels).toBeNull()
    await session.pointer('down', 1, 2)
    await session.key(8)
    await session.resize(16, 8)
    expect(await session.setNumber(0, 1, 3)).toBe(true)
    expect(await session.setNumber(0, 9, 3)).toBe(false)
    expect(await session.setText(0, 1, 'Tank')).toBe(true)
    expect((await session.frame(100, surface)).pixels).toMatchObject({ y0: 2, rows: 4 })
    await session.show(5)
    expect((await session.frame(150, surface)).page).toBe(5)
    session.close()
  })

  it('keeps the running module until a new one has started, and keeps it when the new one fails', async () => {
    const workers: TestWorker[] = []
    const session = createHmiPreviewSession(() => {
      const worker = testWorker()
      workers.push(worker)
      return worker
    })
    await session.load(fakeHost(), start)
    await expect(session.load(fakeHost(), { ...start, width: 0 })).rejects.toThrow('The preview does not fit in memory')
    expect(workers.map((w) => w.terminated)).toEqual([false, true])
    expect((await session.frame(0, surface)).page).toBe(2)
    await session.load(fakeHost(), { ...start, page: 4 })
    expect(workers.map((w) => w.terminated)).toEqual([true, true, false])
    expect((await session.frame(0, surface)).page).toBe(4)
  })

  it('stops the module when screen code faults, and says why', async () => {
    const session = createHmiPreviewSession(() => testWorker())
    const reasons: string[] = []
    session.onStop((reason) => reasons.push(reason))
    await session.load(fakeHost(), start)
    await expect(session.frame(999, surface)).rejects.toThrow('unreachable')
    expect(reasons).toEqual([expect.stringMatching(/^The screen code stopped: .*unreachable/)])
    await expect(session.frame(0, surface)).rejects.toThrow('No preview module is running')
  })

  it('stops a Worker that does not answer in time', async () => {
    const workers: TestWorker[] = []
    const session = createHmiPreviewSession(
      () => {
        const worker = testWorker(workers.length === 0)
        workers.push(worker)
        return worker
      },
      { callTimeoutMs: 50, loadTimeoutMs: 50 },
    )
    await session.load(fakeHost(), start)
    await expect(session.load(fakeHost(), start)).rejects.toThrow('The preview stopped responding')
    expect(workers[1].terminated).toBe(true)
    expect((await session.frame(0, surface)).page).toBe(2)
  })

  it('stops when its Worker crashes, and ignores replies it did not ask for', async () => {
    let worker: TestWorker | undefined
    const session = createHmiPreviewSession(() => {
      worker = testWorker()
      return worker
    })
    const reasons: string[] = []
    const unsubscribe = session.onStop((reason) => reasons.push(reason))
    await session.load(fakeHost(), start)
    worker?.reply({ id: 999, ok: true })
    worker?.reply({ nonsense: true })
    worker?.reply({ id: 1, ok: 'maybe' })
    worker?.crash('')
    expect(reasons).toEqual(['The preview worker failed'])
    unsubscribe()
    await expect(session.key(1)).rejects.toThrow('No preview module is running')
  })

  it('refuses calls after it is closed', async () => {
    const session = createHmiPreviewSession(() => testWorker())
    await session.load(fakeHost(), start)
    session.close()
    await expect(session.frame(0, surface)).rejects.toThrow('The preview was closed')
    await expect(session.load(fakeHost(), start)).rejects.toThrow('The preview was closed')
  })

  it('answers a request it cannot read with an error, and frames before a module with another', async () => {
    const worker = testWorker()
    const replies: unknown[] = []
    worker.addEventListener('message', (event) => replies.push(event.data))
    worker.postMessage({ id: 1, type: 'frame', timeMs: 0, surface }, [])
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(replies).toEqual([{ id: 1, ok: false, error: 'No preview module is loaded', fatal: false }])
  })
})
