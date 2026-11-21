import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningOutcome,
  RuntimeProvisioningRunRequest,
} from '../../../shared/ports/runtime-provisioning-port'
import { createEditorRuntimeProvisioningAdapter } from '../runtime-provisioning-adapter'

interface FakeProvisioningBridge {
  calls: { member: string; args: unknown[] }[]
  probeAnswer: () => Promise<unknown>
  runAnswer: () => Promise<unknown>
  push: (value: unknown) => void
  subscriberCount: () => number
  unsubscribed: number
  runtimeProvisioningProbeSsh: (request: unknown) => Promise<unknown>
  runtimeProvisioningRun: (request: unknown) => Promise<unknown>
  runtimeProvisioningCancel: () => Promise<void>
  onRuntimeProvisioningEvent: (callback: (event: unknown) => void) => () => void
}

interface PendingReply {
  promise: Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: Error) => void
}

interface FollowedRun {
  settled: () => boolean
  outcome: Promise<RuntimeProvisioningOutcome>
}

const REQUEST: RuntimeProvisioningRunRequest = {
  host: '192.168.1.50',
  port: 22,
  username: 'commissioner42',
  password: 'S3cr3t-Pi!',
}

const CONNECTED: RuntimeProvisioningOutcome = { kind: 'connected-ready', operation: 'start' }
const INSTALLER_FAILED: RuntimeProvisioningOutcome = {
  kind: 'installer-failed',
  lastLines: ['ERROR: could not pull the runtime image'],
}
const CONSOLE_EVENT: RuntimeProvisioningEvent = {
  type: 'console',
  level: 'info',
  message: 'ERROR: could not pull the runtime image',
}
const AUDIT_EVENT: RuntimeProvisioningEvent = {
  type: 'audit',
  line: '[runtime-provisioning-audit] target=192.168.1.50:22 operation=install outcome=failure',
}

const MALFORMED_REPLIES: [string, unknown][] = [
  ['a bare outcome', { kind: 'connected-ready', operation: 'start' }],
  ['an end token of 0', { outcome: CONNECTED, endToken: 0 }],
  ['an end token of -1', { outcome: CONNECTED, endToken: -1 }],
  ['an end token of 1.5', { outcome: CONNECTED, endToken: 1.5 }],
  ['an end token given as a string', { outcome: CONNECTED, endToken: '7' }],
  ['an end token past the safe integers', { outcome: CONNECTED, endToken: Number.MAX_SAFE_INTEGER + 1 }],
  ['an envelope with no end token', { outcome: CONNECTED }],
  ['an array', [{ outcome: CONNECTED, endToken: 7 }]],
  ['null', null],
  ['nothing', undefined],
]

let bridge: FakeProvisioningBridge

function pendingReply(): PendingReply {
  let resolve: (value: unknown) => void = () => undefined
  let reject: (error: Error) => void = () => undefined
  const promise = new Promise<unknown>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  for (let turn = 0; turn < 20; turn += 1) await Promise.resolve()
}

function follow(outcome: Promise<RuntimeProvisioningOutcome>, order: string[] = []): FollowedRun {
  let settled = false
  const followed = outcome.then((value) => {
    settled = true
    order.push('resolved')
    return value
  })
  return { settled: () => settled, outcome: followed }
}

function answerInOrder(outcome: RuntimeProvisioningOutcome, endToken: number): void {
  bridge.runAnswer = () => {
    bridge.push({ type: 'run-end', token: endToken })
    return Promise.resolve({ outcome, endToken })
  }
}

function createBridge(): FakeProvisioningBridge {
  const subscribers: ((event: unknown) => void)[] = []
  const fake: FakeProvisioningBridge = {
    calls: [],
    probeAnswer: () => Promise.resolve({ answered: true }),
    runAnswer: () => {
      fake.push({ type: 'run-end', token: 1 })
      return Promise.resolve({ outcome: { kind: 'connected-ready', operation: 'start' }, endToken: 1 })
    },
    push: (value) => [...subscribers].forEach((subscriber) => subscriber(value)),
    subscriberCount: () => subscribers.length,
    unsubscribed: 0,
    runtimeProvisioningProbeSsh: (request) => {
      fake.calls.push({ member: 'runtimeProvisioningProbeSsh', args: [request] })
      return fake.probeAnswer()
    },
    runtimeProvisioningRun: (request) => {
      fake.calls.push({ member: 'runtimeProvisioningRun', args: [request] })
      return fake.runAnswer()
    },
    runtimeProvisioningCancel: () => {
      fake.calls.push({ member: 'runtimeProvisioningCancel', args: [] })
      return Promise.resolve()
    },
    onRuntimeProvisioningEvent: (callback) => {
      fake.calls.push({ member: 'onRuntimeProvisioningEvent', args: [callback] })
      subscribers.push(callback)
      return () => {
        fake.unsubscribed += 1
        subscribers.splice(subscribers.indexOf(callback), 1)
      }
    },
  }
  return fake
}

function membersCalled(): string[] {
  return bridge.calls.map((call) => call.member)
}

beforeEach(() => {
  bridge = createBridge()
  Object.defineProperty(window, 'bridge', { value: bridge, writable: true, configurable: true })
})

describe('the editor runtime provisioning adapter', () => {
  it('has exactly the four port members and calls nothing when created', () => {
    const adapter = createEditorRuntimeProvisioningAdapter()

    expect(Object.keys(adapter).sort()).toEqual(['cancel', 'onEvent', 'probeSsh', 'run'])
    expect(bridge.calls).toEqual([])
  })
})

describe('probeSsh', () => {
  it('forwards the request unchanged and returns the answer', async () => {
    const request = { host: '192.168.1.50', port: 22 }

    await expect(createEditorRuntimeProvisioningAdapter().probeSsh(request)).resolves.toEqual({ answered: true })
    expect(bridge.calls).toEqual([{ member: 'runtimeProvisioningProbeSsh', args: [request] }])
    expect(bridge.calls[0]?.args[0]).toBe(request)
  })

  it('hands a failure reason through', async () => {
    bridge.probeAnswer = () => Promise.resolve({ answered: false, reason: 'refused' })

    await expect(
      createEditorRuntimeProvisioningAdapter().probeSsh({ host: '192.168.1.50', port: 22 }),
    ).resolves.toEqual({ answered: false, reason: 'refused' })
  })

  it.each([
    ['an unknown reason', { answered: false, reason: 'gone' }],
    ['a non-boolean answer', { answered: 'yes' }],
    ['nothing', undefined],
  ])('reads %s from main as unreachable', async (_, value) => {
    bridge.probeAnswer = () => Promise.resolve(value)

    await expect(
      createEditorRuntimeProvisioningAdapter().probeSsh({ host: '192.168.1.50', port: 22 }),
    ).resolves.toEqual({ answered: false, reason: 'unreachable' })
  })

  it('reads a rejected bridge call as unreachable', async () => {
    bridge.probeAnswer = () => Promise.reject(new Error('An object could not be cloned.'))

    await expect(
      createEditorRuntimeProvisioningAdapter().probeSsh({ host: '192.168.1.50', port: 22 }),
    ).resolves.toEqual({ answered: false, reason: 'unreachable' })
  })
})

describe('run', () => {
  it('forwards the request unchanged as the only argument and returns the outcome of the reply', async () => {
    await expect(createEditorRuntimeProvisioningAdapter().run(REQUEST)).resolves.toEqual(CONNECTED)
    const runCalls = bridge.calls.filter((call) => call.member === 'runtimeProvisioningRun')
    expect(runCalls).toEqual([{ member: 'runtimeProvisioningRun', args: [REQUEST] }])
    expect(runCalls[0]?.args[0]).toBe(REQUEST)
  })

  it('hands an outcome with details through', async () => {
    answerInOrder({ kind: 'host-key-changed', target: '192.0.2.10:22' }, 3)

    await expect(createEditorRuntimeProvisioningAdapter().run(REQUEST)).resolves.toEqual({
      kind: 'host-key-changed',
      target: '192.0.2.10:22',
    })
  })

  it('subscribes once to the event channel before it calls the bridge, and removes that subscription once settled', async () => {
    const run = follow(createEditorRuntimeProvisioningAdapter().run(REQUEST))
    await flushMicrotasks()

    expect(run.settled()).toBe(true)
    expect(membersCalled()).toEqual(['onRuntimeProvisioningEvent', 'runtimeProvisioningRun'])
    expect(bridge.unsubscribed).toBe(1)
    expect(bridge.subscriberCount()).toBe(0)
  })

  it('subscribes and unsubscribes once for each run', async () => {
    const adapter = createEditorRuntimeProvisioningAdapter()

    await adapter.run(REQUEST)
    await adapter.run(REQUEST)

    expect(membersCalled()).toEqual([
      'onRuntimeProvisioningEvent',
      'runtimeProvisioningRun',
      'onRuntimeProvisioningEvent',
      'runtimeProvisioningRun',
    ])
    expect(bridge.unsubscribed).toBe(2)
    expect(bridge.subscriberCount()).toBe(0)
  })

  it('resolves only after the events sent before the end marker reached the subscribers, when the reply comes first', async () => {
    const order: string[] = []
    const received: RuntimeProvisioningEvent[] = []
    const adapter = createEditorRuntimeProvisioningAdapter()
    adapter.onEvent((event) => {
      received.push(event)
      order.push(event.type)
    })
    const reply = pendingReply()
    bridge.runAnswer = () => reply.promise

    const run = follow(adapter.run(REQUEST), order)
    reply.resolve({ outcome: INSTALLER_FAILED, endToken: 7 })
    await flushMicrotasks()
    const settledOnTheReplyAlone = run.settled()
    bridge.push(CONSOLE_EVENT)
    bridge.push(AUDIT_EVENT)
    bridge.push({ type: 'run-end', token: 7 })
    await flushMicrotasks()

    expect(settledOnTheReplyAlone).toBe(false)
    expect(run.settled()).toBe(true)
    await expect(run.outcome).resolves.toEqual(INSTALLER_FAILED)
    expect(order).toEqual(['console', 'audit', 'resolved'])
    expect(received).toEqual([CONSOLE_EVENT, AUDIT_EVENT])
  })

  it('resolves as soon as the reply arrives when its end marker came first', async () => {
    const reply = pendingReply()
    bridge.runAnswer = () => reply.promise

    const run = follow(createEditorRuntimeProvisioningAdapter().run(REQUEST))
    bridge.push({ type: 'run-end', token: 7 })
    await flushMicrotasks()
    const settledOnTheMarkerAlone = run.settled()
    reply.resolve({ outcome: INSTALLER_FAILED, endToken: 7 })
    await flushMicrotasks()

    expect(settledOnTheMarkerAlone).toBe(false)
    expect(run.settled()).toBe(true)
    await expect(run.outcome).resolves.toEqual(INSTALLER_FAILED)
  })

  it('ignores an end marker with another token', async () => {
    const reply = pendingReply()
    bridge.runAnswer = () => reply.promise

    const run = follow(createEditorRuntimeProvisioningAdapter().run(REQUEST))
    reply.resolve({ outcome: INSTALLER_FAILED, endToken: 7 })
    bridge.push({ type: 'run-end', token: 6 })
    await flushMicrotasks()
    const settledOnAnotherToken = run.settled()
    bridge.push({ type: 'run-end', token: 7 })
    await flushMicrotasks()

    expect(settledOnAnotherToken).toBe(false)
    expect(run.settled()).toBe(true)
    await expect(run.outcome).resolves.toEqual(INSTALLER_FAILED)
  })

  it('reads an envelope whose outcome is not known as unknown, once its end marker arrived', async () => {
    const reply = pendingReply()
    bridge.runAnswer = () => reply.promise

    const run = follow(createEditorRuntimeProvisioningAdapter().run(REQUEST))
    reply.resolve({ outcome: { kind: 'exploded' }, endToken: 7 })
    await flushMicrotasks()
    const settledOnTheReplyAlone = run.settled()
    bridge.push({ type: 'run-end', token: 7 })
    await flushMicrotasks()

    expect(settledOnTheReplyAlone).toBe(false)
    expect(run.settled()).toBe(true)
    await expect(run.outcome).resolves.toEqual({ kind: 'unknown' })
  })

  it.each(MALFORMED_REPLIES)('reads %s from main as unknown at once and removes its subscription', async (_, value) => {
    bridge.runAnswer = () => Promise.resolve(value)

    const run = follow(createEditorRuntimeProvisioningAdapter().run(REQUEST))
    await flushMicrotasks()

    expect(run.settled()).toBe(true)
    await expect(run.outcome).resolves.toEqual({ kind: 'unknown' })
    expect(bridge.unsubscribed).toBe(1)
    expect(bridge.subscriberCount()).toBe(0)
  })

  it('reads a rejected bridge call as unknown at once and removes its subscription', async () => {
    bridge.runAnswer = () => Promise.reject(new Error('reply was never sent'))

    const run = follow(createEditorRuntimeProvisioningAdapter().run(REQUEST))
    await flushMicrotasks()

    expect(run.settled()).toBe(true)
    await expect(run.outcome).resolves.toEqual({ kind: 'unknown' })
    expect(bridge.unsubscribed).toBe(1)
    expect(bridge.subscriberCount()).toBe(0)
  })

  it('never passes an end marker to an event subscriber', async () => {
    const received: RuntimeProvisioningEvent[] = []
    const adapter = createEditorRuntimeProvisioningAdapter()
    adapter.onEvent((event) => received.push(event))
    answerInOrder(CONNECTED, 4)

    await adapter.run(REQUEST)

    expect(received).toEqual([])
  })
})

describe('cancel', () => {
  it('forwards to the bridge', async () => {
    await expect(createEditorRuntimeProvisioningAdapter().cancel()).resolves.toBeUndefined()
    expect(membersCalled()).toEqual(['runtimeProvisioningCancel'])
  })
})

describe('onEvent', () => {
  it('subscribes once and passes on only the events the shared guard accepts', () => {
    const received: RuntimeProvisioningEvent[] = []
    createEditorRuntimeProvisioningAdapter().onEvent((event) => received.push(event))

    bridge.push({ type: 'phase', phase: 'installing', cancellable: false, operation: 'install' })
    bridge.push({ type: 'phase', phase: 'rebooting', cancellable: false })
    bridge.push({ type: 'output', line: 'Done' })
    bridge.push({ type: 'output', line: 42 })
    bridge.push('garbage')
    bridge.push({ type: 'audit', line: '[runtime-provisioning-audit] target=192.168.1.50:22' })

    expect(membersCalled()).toEqual(['onRuntimeProvisioningEvent'])
    expect(received).toEqual([
      { type: 'phase', phase: 'installing', cancellable: false, operation: 'install' },
      { type: 'output', line: 'Done' },
      { type: 'audit', line: '[runtime-provisioning-audit] target=192.168.1.50:22' },
    ])
  })

  it('passes no run-end marker on', () => {
    const received: RuntimeProvisioningEvent[] = []
    createEditorRuntimeProvisioningAdapter().onEvent((event) => received.push(event))

    bridge.push({ type: 'run-end', token: 7 })

    expect(received).toEqual([])
  })

  it('hands back an unsubscribe that stops the bridge subscription', () => {
    const received: RuntimeProvisioningEvent[] = []
    const unsubscribe = createEditorRuntimeProvisioningAdapter().onEvent((event) => received.push(event))

    unsubscribe()
    bridge.push({ type: 'output', line: 'late' })

    expect(bridge.unsubscribed).toBe(1)
    expect(received).toEqual([])
  })
})
