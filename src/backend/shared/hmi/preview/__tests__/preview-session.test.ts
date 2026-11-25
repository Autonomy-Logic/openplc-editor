/** @jest-environment node */
import type { HmiLiveElement } from '../../../../../middleware/shared/ports/hmi-preview-types'
import { createHmiPreviewSession } from '../preview-session'
import { parseHmiPreviewRequest, serveHmiPreview } from '../preview-worker'
import { fakeHost, type TestWorker, testWorker } from './fixtures/support'

const start = { width: 16, height: 8, page: 2, design: true }
const surface = { width: 16, height: 8, scale: 1 }
const live: HmiLiveElement = {
  type: 1,
  parent: { id: 0 },
  parentKind: 'stack',
  before: 0,
  drawBefore: 0,
  numbers: [{ setter: 1, value: 3 }],
  texts: [{ setter: 1, value: 'Label' }],
}

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
      { id: 9, type: 'setNumber', screen: 0, setter: 1, value: 2, element: 100 },
      { id: 10, type: 'setText', screen: 0, setter: 1, value: 'a', element: 100 },
      {
        id: 11,
        type: 'change',
        detach: [{ element: 4, parent: 0, parentKind: 'stack' }],
        elements: [live, { ...live, parent: { added: 0 }, parentKind: 'diagram', element: 4 }],
      },
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
      { id: 1, type: 'setText', screen: 0, setter: 1, value: 'a', element: 1.5 },
      { id: 1, type: 'change', detach: [], elements: [{ ...live, parentKind: 'grid' }] },
      { id: 1, type: 'change', detach: [], elements: [{ ...live, parent: {} }] },
      { id: 1, type: 'change', detach: [], elements: [{ ...live, numbers: [{ setter: 1, value: 'x' }] }] },
      { id: 1, type: 'change', detach: [], elements: [{ ...live, element: 'x' }] },
      { id: 1, type: 'change', detach: [], elements: live },
      { id: 1, type: 'change', detach: [{ element: 1, parent: 0, parentKind: 'row' }], elements: [] },
      { id: 1, type: 'change', elements: [] },
      { id: 1, type: 'exit' },
    ])
      expect(parseHmiPreviewRequest(value)).toBeNull()
  })
})

describe('serveHmiPreview', () => {
  it('answers requests one at a time in order, so a change sent during a load reaches the loaded module', async () => {
    const listeners: Array<(event: MessageEvent<unknown>) => void> = []
    const replies: unknown[] = []
    serveHmiPreview({
      postMessage: (message) => replies.push(message),
      addEventListener: (_type, listener) => listeners.push(listener),
    })
    const send = (data: unknown) => listeners.forEach((l) => l(new MessageEvent('message', { data })))
    send({ id: 1, type: 'load', wasm: fakeHost(), width: 16, height: 8, page: 0, design: false })
    send({ id: 2, type: 'change', detach: [], elements: [live] })
    send({ id: 3, type: 'setNumber', screen: 0, setter: 1, value: 2, element: 100 })
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(replies).toEqual([
      { id: 1, ok: true },
      { id: 2, ok: true, applied: true, added: [100] },
      { id: 3, ok: true, applied: true },
    ])
  })
})

describe('preview session', () => {
  it('lands loads in the order they were asked for, whichever module starts first', async () => {
    let started = 0
    const session = createHmiPreviewSession(() => {
      const worker = testWorker()
      if (started++ > 0) return worker
      const post = worker.postMessage.bind(worker)
      return { ...worker, postMessage: (message, transfer) => void setTimeout(() => post(message, transfer), 60) }
    })
    const first = session.load(fakeHost(), { ...start, page: 1 })
    const second = session.load(fakeHost(), { ...start, page: 2 })
    await Promise.all([first, second])
    expect((await session.frame(0, surface)).page).toBe(2)
    session.close()
  })

  it('runs a module in its Worker: frames with what they drew, input and live edits', async () => {
    const session = createHmiPreviewSession(() => testWorker())
    await session.load(fakeHost(), start)
    const frame = await session.frame(0, surface)
    expect(frame).toMatchObject({ page: 2, status: 0, pixels: { y0: 0, rows: 8 } })
    expect(frame.bounds).toHaveLength(2)
    expect(frame.drawn).toEqual({ x: 1, y: 2, width: 2, height: 3 })
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

  it('changes the structure live, edits live elements, or reports that it could not', async () => {
    const session = createHmiPreviewSession(() => testWorker())
    await session.load(fakeHost(), start)
    await session.frame(0, surface)
    expect(await session.change([], [live, { ...live, parent: { added: 0 } }])).toEqual([100, 101])
    expect((await session.frame(50, surface)).pixels).toMatchObject({ y0: 2, rows: 4 })
    expect(await session.setNumber(2, 1, 9, 101)).toBe(true)
    expect(await session.setText(2, 1, 'Tank', 100)).toBe(true)
    expect(await session.setNumber(2, 2, 9, 101)).toBe(false)
    expect(await session.change([{ element: 7, parent: 0, parentKind: 'stack' }], [])).toEqual([])
    expect(await session.change([{ element: 7, parent: 0, parentKind: 'stack' }], [])).toBeNull()
    expect(await session.change([], [{ ...live, element: 7, numbers: [], texts: [] }])).toEqual([7])
    expect(await session.change([], [{ ...live, type: 7 }])).toBeNull()
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
