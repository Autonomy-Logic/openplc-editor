import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningRunRequest,
} from '../../../shared/ports/runtime-provisioning-port'
import { createEditorRuntimeProvisioningAdapter } from '../runtime-provisioning-adapter'

interface FakeProvisioningBridge {
  calls: { member: string; args: unknown[] }[]
  probeAnswer: () => Promise<unknown>
  runAnswer: () => Promise<unknown>
  push: (value: unknown) => void
  unsubscribed: number
  runtimeProvisioningProbeSsh: (request: unknown) => Promise<unknown>
  runtimeProvisioningRun: (request: unknown) => Promise<unknown>
  runtimeProvisioningCancel: () => Promise<void>
  onRuntimeProvisioningEvent: (callback: (event: unknown) => void) => () => void
}

const REQUEST: RuntimeProvisioningRunRequest = {
  host: '192.168.1.50',
  port: 22,
  username: 'commissioner42',
  password: 'S3cr3t-Pi!',
}

let bridge: FakeProvisioningBridge

function createBridge(): FakeProvisioningBridge {
  const subscribers: ((event: unknown) => void)[] = []
  const fake: FakeProvisioningBridge = {
    calls: [],
    probeAnswer: () => Promise.resolve({ answered: true }),
    runAnswer: () => Promise.resolve({ kind: 'connected-ready', operation: 'start' }),
    push: (value) => subscribers.forEach((subscriber) => subscriber(value)),
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
  it('forwards the request unchanged and returns the outcome', async () => {
    await expect(createEditorRuntimeProvisioningAdapter().run(REQUEST)).resolves.toEqual({
      kind: 'connected-ready',
      operation: 'start',
    })
    expect(bridge.calls).toEqual([{ member: 'runtimeProvisioningRun', args: [REQUEST] }])
    expect(bridge.calls[0]?.args[0]).toBe(REQUEST)
  })

  it('hands an outcome with details through', async () => {
    bridge.runAnswer = () => Promise.resolve({ kind: 'host-key-changed', target: '192.0.2.10:22' })

    await expect(createEditorRuntimeProvisioningAdapter().run(REQUEST)).resolves.toEqual({
      kind: 'host-key-changed',
      target: '192.0.2.10:22',
    })
  })

  it.each([
    ['an unknown kind', { kind: 'exploded' }],
    ['a host-key-changed outcome without its target', { kind: 'host-key-changed' }],
    ['nothing', undefined],
  ])('reads %s from main as unknown', async (_, value) => {
    bridge.runAnswer = () => Promise.resolve(value)

    await expect(createEditorRuntimeProvisioningAdapter().run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
  })

  it('reads a rejected bridge call as unknown', async () => {
    bridge.runAnswer = () => Promise.reject(new Error('reply was never sent'))

    await expect(createEditorRuntimeProvisioningAdapter().run(REQUEST)).resolves.toEqual({ kind: 'unknown' })
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

  it('hands back an unsubscribe that stops the bridge subscription', () => {
    const received: RuntimeProvisioningEvent[] = []
    const unsubscribe = createEditorRuntimeProvisioningAdapter().onEvent((event) => received.push(event))

    unsubscribe()
    bridge.push({ type: 'output', line: 'late' })

    expect(bridge.unsubscribed).toBe(1)
    expect(received).toEqual([])
  })
})
