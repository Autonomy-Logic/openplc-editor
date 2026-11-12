import { EventEmitter } from 'node:events'

import { createRuntimeProvisioningService } from '../../../../backend/shared/runtime-provisioning/service'
import type { FakeDevice } from '../../../../backend/shared/runtime-provisioning/__tests__/fixtures/in-memory-mechanisms'
import {
  auditWrites,
  createFakeDevice as createFakeSshDevice,
  DEVICE_PASSWORD,
} from '../../../../backend/shared/runtime-provisioning/__tests__/fixtures/in-memory-mechanisms'
import {
  createCallLog,
  createFakeDevice as createFakeDevicePort,
  FakeRuntime,
  type PortCallLog,
  RUNTIME_V4,
  selectRuntimeTarget,
  unexpectedCalls,
} from '../../../../frontend/services/__tests__/fixtures/runtime-ports'
import { submitProvisioningRun } from '../../../../frontend/services/runtime-provisioning'
import type { OpenPLCStore } from '../../../../frontend/store'
import { createTestStore } from '../../../../frontend/store/testing'
import { createEditorRuntimeProvisioningAdapter } from '../../../../middleware/adapters/editor/runtime-provisioning-adapter'
import { registerRuntimeProvisioning } from '../index'

jest.mock('electron', () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs')
  const os = jest.requireActual<typeof import('node:os')>('node:os')
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path')
  const userData = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'provisioning-ordering-electron-'))
  return { app: { getPath: () => userData } }
})

const PROBE = 'runtime-provisioning:probe-ssh'
const RUN = 'runtime-provisioning:run'
const CANCEL = 'runtime-provisioning:cancel'
const EVENT = 'runtime-provisioning:event'

const HOST = '192.168.1.50'
const USERNAME = 'commissioner42'
const INSTALLER_LINES = ['Installing Docker', 'Reading package lists...', 'E: Unable to locate package docker-ce']

/** A web contents that holds every message it is sent until the test delivers them. */
class QueuedWebContents extends EventEmitter {
  private queued: { channel: string; payload: unknown }[] = []

  send(channel: string, ...args: unknown[]): void {
    this.queued.push({ channel, payload: args[0] })
  }

  isDestroyed(): boolean {
    return false
  }

  takeQueued(channel: string): unknown[] {
    const taken = this.queued.filter((message) => message.channel === channel).map((message) => message.payload)
    this.queued = this.queued.filter((message) => message.channel !== channel)
    return taken
  }
}

type InvokeHandler = (event: { sender: QueuedWebContents }, ...args: unknown[]) => unknown

class FakeIpcMain {
  private readonly handlers = new Map<string, InvokeHandler>()

  handle(channel: string, handler: InvokeHandler): void {
    this.handlers.set(channel, handler)
  }

  invoke(channel: string, sender: QueuedWebContents, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (handler === undefined) return Promise.reject(new Error(`No handler registered for '${channel}'`))
    return Promise.resolve(handler({ sender }, ...args))
  }
}

class FakeApp extends EventEmitter {}

/** A preload bridge whose run reply reaches the renderer before any event message sent ahead of it. */
interface ReorderingBridge {
  replied: Promise<void>
  deliverQueuedEvents(): void
  runtimeProvisioningProbeSsh(request: unknown): Promise<unknown>
  runtimeProvisioningRun(request: unknown): Promise<unknown>
  runtimeProvisioningCancel(): Promise<void>
  onRuntimeProvisioningEvent(callback: (event: unknown) => void): () => void
}

function createReorderingBridge(ipc: FakeIpcMain, contents: QueuedWebContents): ReorderingBridge {
  const subscribers: ((event: unknown) => void)[] = []
  let markReplied: () => void = () => undefined
  const replied = new Promise<void>((resolve) => {
    markReplied = resolve
  })
  return {
    replied,
    deliverQueuedEvents() {
      for (const payload of contents.takeQueued(EVENT)) {
        for (const subscriber of [...subscribers]) subscriber(payload)
      }
    },
    runtimeProvisioningProbeSsh: (request) => ipc.invoke(PROBE, contents, request),
    async runtimeProvisioningRun(request) {
      const reply = await ipc.invoke(RUN, contents, request)
      markReplied()
      return reply
    },
    async runtimeProvisioningCancel() {
      await ipc.invoke(CANCEL, contents)
    },
    onRuntimeProvisioningEvent(callback) {
      subscribers.push(callback)
      return () => {
        const index = subscribers.indexOf(callback)
        if (index >= 0) subscribers.splice(index, 1)
      }
    },
  }
}

async function letTheReplyLand(): Promise<void> {
  for (let turn = 0; turn < 50; turn += 1) await Promise.resolve()
}

let store: OpenPLCStore
let log: PortCallLog
let sshDevice: FakeDevice
let bridge: ReorderingBridge

function consoleMessages(): string[] {
  return store.getState().logs.map(({ message }) => message)
}

function timesInConsole(message: string): number {
  return consoleMessages().filter((logged) => logged === message).length
}

beforeEach(() => {
  sshDevice = createFakeSshDevice({
    polls: [
      { exit: 'running', text: `${INSTALLER_LINES[0]}\n${INSTALLER_LINES[1]}\n` },
      { exit: 'running', text: `${INSTALLER_LINES[2]}\n` },
      { exit: 1 },
    ],
  })
  const ipc = new FakeIpcMain()
  const contents = new QueuedWebContents()
  registerRuntimeProvisioning({
    ipcMain: ipc,
    app: new FakeApp(),
    service: createRuntimeProvisioningService(sshDevice.mechanisms),
  })
  bridge = createReorderingBridge(ipc, contents)
  Object.defineProperty(window, 'bridge', { value: bridge, writable: true, configurable: true })
  store = createTestStore()
  log = createCallLog()
  selectRuntimeTarget(store, RUNTIME_V4, HOST)
  store.getState().runtimeProvisioningActions.showOffer(HOST, 22)
})

afterEach(() => {
  expect(unexpectedCalls(log)).toEqual([])
})

async function submitWithTheReplyFirst(): Promise<void> {
  const ports = {
    runtime: new FakeRuntime(log).port,
    device: createFakeDevicePort(log),
    runtimeProvisioning: createEditorRuntimeProvisioningAdapter(),
  }
  const submitted = submitProvisioningRun(store, ports, { username: USERNAME, password: DEVICE_PASSWORD, sshPort: 22 })
  await bridge.replied
  await letTheReplyLand()
  bridge.deliverQueuedEvents()
  await submitted
}

describe('a provisioning run whose reply crosses IPC ahead of its events', () => {
  it('puts every installer line written before the failure in the editor console exactly once', async () => {
    await submitWithTheReplyFirst()

    expect(INSTALLER_LINES.map(timesInConsole)).toEqual([1, 1, 1])
  })

  it('puts the audit entry of the run in the editor console exactly once', async () => {
    await submitWithTheReplyFirst()
    const [auditLine] = auditWrites(sshDevice)

    expect(auditWrites(sshDevice)).toHaveLength(1)
    expect(timesInConsole(auditLine ?? '')).toBe(1)
  })

  it('shows the installer failure as the ending', async () => {
    await submitWithTheReplyFirst()
    const view = store.getState().runtimeProvisioning.view

    expect(view.stage).toBe('ended')
    expect(view.stage === 'ended' ? view.outcome : null).toEqual({
      kind: 'installer-failed',
      lastLines: INSTALLER_LINES,
    })
  })
})
