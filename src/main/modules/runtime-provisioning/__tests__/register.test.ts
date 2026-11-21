/** @jest-environment node */

import { EventEmitter } from 'node:events'

import { formatAuditLine } from '../../../../backend/shared/runtime-provisioning/audit'
import type { RuntimeProvisioningService } from '../../../../backend/shared/runtime-provisioning/service'
import { createRuntimeProvisioningService } from '../../../../backend/shared/runtime-provisioning/service'
import type {
  FakeDevice,
  FakeDeviceOptions,
} from '../../../../backend/shared/runtime-provisioning/__tests__/fixtures/in-memory-mechanisms'
import {
  auditWrites,
  countOf,
  createFakeDevice,
  DEVICE_PASSWORD,
  START_TIME,
  systemOutput,
} from '../../../../backend/shared/runtime-provisioning/__tests__/fixtures/in-memory-mechanisms'
import type {
  RuntimeProvisioningEvent,
  RuntimeProvisioningRunRequest,
} from '../../../../middleware/shared/ports/runtime-provisioning-port'
import { registerRuntimeProvisioning } from '../index'

jest.mock('electron', () => {
  const fs = jest.requireActual<typeof import('node:fs')>('node:fs')
  const os = jest.requireActual<typeof import('node:os')>('node:os')
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path')
  const userData = fs.mkdtempSync(nodePath.join(os.tmpdir(), 'provisioning-electron-'))
  return { app: { getPath: () => userData } }
})

const PROBE = 'runtime-provisioning:probe-ssh'
const RUN = 'runtime-provisioning:run'
const CANCEL = 'runtime-provisioning:cancel'
const EVENT = 'runtime-provisioning:event'

const REQUEST: RuntimeProvisioningRunRequest = {
  host: '192.168.1.50',
  port: 22,
  username: 'commissioner42',
  password: DEVICE_PASSWORD,
}

const HOST_253 = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.')
const HOST_254 = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(62)].join('.')

class FakeWebContents extends EventEmitter {
  readonly sent: { channel: string; args: unknown[] }[] = []
  readonly sentWhileDestroyed: string[] = []
  private destroyed = false

  send(channel: string, ...args: unknown[]): void {
    if (this.destroyed) this.sentWhileDestroyed.push(channel)
    else this.sent.push({ channel, args })
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }

  crash(): void {
    this.emit('render-process-gone', { preventDefault: () => undefined }, { reason: 'crashed', exitCode: 1 })
  }

  navigate(isMainFrame: boolean): void {
    const url = 'http://localhost/index.html'
    const details = { url, isMainFrame, isSameDocument: false, isInPlace: false, frame: null }
    this.emit('did-start-navigation', details, url, false, isMainFrame, 1, 1)
  }

  provisioningEvents(): unknown[] {
    return this.sent.filter((message) => message.channel === EVENT).map((message) => message.args)
  }
}

type InvokeHandler = (event: { sender: FakeWebContents }, ...args: unknown[]) => unknown

class FakeIpcMain {
  readonly handlers = new Map<string, InvokeHandler>()
  readonly listeners: string[] = []

  handle(channel: string, handler: InvokeHandler): void {
    if (this.handlers.has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`)
    this.handlers.set(channel, handler)
  }

  on(channel: string, _listener: (...args: unknown[]) => void): this {
    this.listeners.push(channel)
    return this
  }

  invoke(channel: string, sender: FakeWebContents, ...args: unknown[]): Promise<unknown> {
    const handler = this.handlers.get(channel)
    if (handler === undefined) return Promise.reject(new Error(`No handler registered for '${channel}'`))
    return Promise.resolve(handler({ sender }, ...args))
  }
}

interface QuitEvent {
  preventDefault(): void
}

class FakeApp extends EventEmitter {
  quit(): { prevented: boolean } {
    const outcome = { prevented: false }
    const event: QuitEvent = {
      preventDefault: () => {
        outcome.prevented = true
      },
    }
    this.emit('before-quit', event)
    if (!outcome.prevented) this.emit('will-quit', event)
    return outcome
  }

  preventNextQuits(): void {
    this.on('before-quit', (event: QuitEvent) => event.preventDefault())
  }
}

type DetachReason = Parameters<RuntimeProvisioningService['detach']>[0]

interface Harness {
  failRun: Error | null
  device: FakeDevice
  ipc: FakeIpcMain
  app: FakeApp
  renderer: FakeWebContents
  other: FakeWebContents
  probes: unknown[]
  runs: unknown[]
  cancels: number
  detaches: DetachReason[]
  serviceEvents: RuntimeProvisioningEvent[]
}

function setup(options: (harness: Harness) => FakeDeviceOptions = () => ({})): Harness {
  const harness: Harness = {
    failRun: null,
    device: createFakeDevice(),
    ipc: new FakeIpcMain(),
    app: new FakeApp(),
    renderer: new FakeWebContents(),
    other: new FakeWebContents(),
    probes: [],
    runs: [],
    cancels: 0,
    detaches: [],
    serviceEvents: [],
  }
  harness.device = createFakeDevice(options(harness))
  const real = createRuntimeProvisioningService(harness.device.mechanisms)
  harness.device.watch(real)
  real.onEvent((event) => harness.serviceEvents.push(event))
  const service: RuntimeProvisioningService = {
    probeSsh: (request) => {
      harness.probes.push(request)
      return real.probeSsh(request)
    },
    run: (request) => {
      harness.runs.push(request)
      if (harness.failRun !== null) return Promise.reject(harness.failRun)
      return real.run(request)
    },
    cancel: () => {
      harness.cancels += 1
      return real.cancel()
    },
    onEvent: (callback) => real.onEvent(callback),
    detach: (reason) => {
      harness.detaches.push(reason)
      real.detach(reason)
    },
    inspectState: () => real.inspectState(),
  }
  registerRuntimeProvisioning({ ipcMain: harness.ipc, app: harness.app, service })
  return harness
}

function duringInspection(act: (harness: Harness) => void): (harness: Harness) => FakeDeviceOptions {
  return (harness) => ({
    commands: {
      probeSystem: () => {
        act(harness)
        return { stdout: systemOutput() }
      },
    },
  })
}

function expectedUnknownAudit(device: FakeDevice): string {
  return formatAuditLine({
    host: REQUEST.host,
    port: REQUEST.port,
    operation: 'inspect',
    startedAt: START_TIME,
    endedAt: device.clock.current(),
    outcome: 'unknown',
  })
}

interface RunReply {
  outcome: unknown
  endToken: number
}

function runReply(value: unknown): RunReply {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`the run reply is not an envelope: ${JSON.stringify(value)}`)
  }
  if (!('endToken' in value) || typeof value.endToken !== 'number') {
    throw new Error(`the run reply carries no end token: ${JSON.stringify(value)}`)
  }
  return { outcome: 'outcome' in value ? value.outcome : undefined, endToken: value.endToken }
}

function envelope(outcome: object): { outcome: object; endToken: number } {
  return { outcome, endToken: expect.any(Number) }
}

function runEnd(token: number): unknown[] {
  return [{ type: 'run-end', token }]
}

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the provisioning IPC surface', () => {
  it('registers exactly the probe, run and cancel handlers, and nothing else', () => {
    const { ipc } = setup()

    expect([...ipc.handlers.keys()].sort()).toEqual([CANCEL, PROBE, RUN])
    expect(ipc.listeners).toEqual([])
  })
})

describe('runtime-provisioning:probe-ssh', () => {
  it('hands a valid request to the service and returns its answer', async () => {
    const { ipc, renderer, probes } = setup()

    await expect(ipc.invoke(PROBE, renderer, { host: '192.168.1.50', port: 22 })).resolves.toEqual({
      answered: true,
    })
    expect(probes).toEqual([{ host: '192.168.1.50', port: 22 }])
  })

  it.each([
    ['an extra command field', { host: '192.168.1.50', port: 22, command: 'id' }],
    ['port 0', { host: '192.168.1.50', port: 0 }],
    ['the port as a string', { host: '192.168.1.50', port: '22' }],
    ['an invalid host', { host: 'not a host!', port: 22 }],
    ['no payload', undefined],
    ['a string payload', '192.168.1.50:22'],
    ['a null payload', null],
  ])('refuses %s as invalid input, with no service call and no socket (M9)', async (_, payload) => {
    const { ipc, renderer, probes, device } = setup()

    await expect(ipc.invoke(PROBE, renderer, payload)).resolves.toEqual({ answered: false, reason: 'invalid-input' })
    expect(probes).toEqual([])
    expect(device.log).toEqual([])
  })
})

describe('runtime-provisioning:run validation (AS-05, AS-04, AS-07, M9)', () => {
  it.each([
    ['port 1', { ...REQUEST, port: 1 }],
    ['port 65535', { ...REQUEST, port: 65535 }],
    ['a valid hostname of 253 characters', { ...REQUEST, host: HOST_253 }],
    ['a username of 32 characters', { ...REQUEST, username: 'u'.repeat(32) }],
    ['a password of 1,024 characters', { ...REQUEST, password: 'p'.repeat(1024) }],
  ])('accepts %s and returns the outcome of the service', async (_, payload) => {
    const { ipc, renderer, runs } = setup(() => ({ devicePassword: payload.password }))

    await expect(ipc.invoke(RUN, renderer, payload)).resolves.toEqual(
      envelope({ kind: 'connected-ready', operation: 'install' }),
    )
    expect(runs).toEqual([payload])
  })

  it.each([
    ['port 0', { ...REQUEST, port: 0 }, 'port'],
    ['port 65536', { ...REQUEST, port: 65536 }, 'port'],
    ['port "22" as a string', { ...REQUEST, port: '22' }, 'port'],
    ['port 22.5', { ...REQUEST, port: 22.5 }, 'port'],
    ['a hostname of 254 characters', { ...REQUEST, host: HOST_254 }, 'host'],
    ['a username of 33 characters', { ...REQUEST, username: 'u'.repeat(33) }, 'username'],
    ['a password of 1,025 characters', { ...REQUEST, password: 'p'.repeat(1025) }, 'password'],
    ['a password containing a line feed', { ...REQUEST, password: 'S3cr3t\nid' }, 'password'],
    ['an extra field "operation": "install"', { ...REQUEST, operation: 'install' }, 'payload'],
    ['an extra field "command": "id"', { ...REQUEST, command: 'id' }, 'payload'],
    ['an extra field "installerUrl"', { ...REQUEST, installerUrl: 'https://example.com/i.sh' }, 'payload'],
    ['no payload', undefined, 'payload'],
    ['an array payload', [REQUEST], 'payload'],
  ])('rejects %s before any service call or connection', async (_, payload, field) => {
    const { ipc, renderer, runs, device } = setup()

    await expect(ipc.invoke(RUN, renderer, payload)).resolves.toEqual(envelope({ kind: 'invalid-input', field }))
    expect(runs).toEqual([])
    expect(device.log).toEqual([])
  })

  it.each([
    ['port 0', { ...REQUEST, port: 0 }],
    ['an extra field "command": "id"', { ...REQUEST, command: 'id' }],
    ['no payload', undefined],
  ])(
    'sends the caller of a rejected %s exactly one end marker with its reply token, and no service event',
    async (_, payload) => {
      const { ipc, renderer, serviceEvents } = setup()

      const reply = runReply(await ipc.invoke(RUN, renderer, payload))

      expect(serviceEvents).toEqual([])
      expect(renderer.provisioningEvents()).toEqual([runEnd(reply.endToken)])
    },
  )
})

describe('progress events', () => {
  it('sends every service event, in order, to the renderer that started the run, one payload each, then one end marker with the reply token', async () => {
    const { ipc, renderer, serviceEvents } = setup()

    const reply = runReply(await ipc.invoke(RUN, renderer, REQUEST))

    expect(serviceEvents.length).toBeGreaterThan(0)
    expect(serviceEvents[serviceEvents.length - 1]?.type).toBe('audit')
    expect(renderer.provisioningEvents()).toEqual([...serviceEvents.map((event) => [event]), runEnd(reply.endToken)])
  })

  it('replies to an owned run with exactly the outcome and the end token', async () => {
    const { ipc, renderer } = setup()

    const reply = await ipc.invoke(RUN, renderer, REQUEST)

    expect(reply).toEqual({
      outcome: { kind: 'connected-ready', operation: 'install' },
      endToken: runReply(reply).endToken,
    })
  })

  it('gives every run invocation a new positive end token, increasing across invocations', async () => {
    const busy: Promise<unknown>[] = []
    const { ipc, renderer, other } = setup(
      duringInspection((current) => {
        if (busy.length === 0) busy.push(current.ipc.invoke(RUN, current.other, REQUEST))
      }),
    )

    const invalid = runReply(await ipc.invoke(RUN, renderer, { ...REQUEST, port: 0 }))
    const owned = runReply(await ipc.invoke(RUN, renderer, REQUEST))
    const busyReply = runReply(await Promise.all(busy).then(([value]) => value))
    const second = runReply(await ipc.invoke(RUN, other, REQUEST))
    const tokens = [invalid.endToken, busyReply.endToken, owned.endToken, second.endToken]

    expect(busyReply.outcome).toEqual({ kind: 'busy' })
    for (const token of tokens) {
      expect(Number.isSafeInteger(token)).toBe(true)
      expect(token).toBeGreaterThan(0)
    }
    expect(new Set(tokens).size).toBe(tokens.length)
    expect(invalid.endToken).toBeLessThan(owned.endToken)
    expect(busyReply.endToken).toBeGreaterThan(owned.endToken)
    expect(second.endToken).toBeGreaterThan(busyReply.endToken)
  })

  it('still sends the end marker, and passes the rejection on, when the service run rejects', async () => {
    const harness = setup()
    harness.failRun = new Error('service failed')

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).rejects.toThrow('service failed')
    expect(harness.renderer.provisioningEvents()).toEqual([[{ type: 'run-end', token: expect.any(Number) }]])
  })

  it('sends nothing to a renderer that only probed', async () => {
    const { ipc, renderer, other } = setup()

    await ipc.invoke(PROBE, other, { host: '192.168.1.50', port: 22 })
    await ipc.invoke(RUN, renderer, REQUEST)

    expect(other.provisioningEvents()).toEqual([])
  })

  it('follows the renderer of each run', async () => {
    const { ipc, renderer, other } = setup()

    await ipc.invoke(RUN, renderer, REQUEST)
    const firstRunEvents = renderer.provisioningEvents().length
    await ipc.invoke(RUN, other, REQUEST)

    expect(renderer.provisioningEvents()).toHaveLength(firstRunEvents)
    expect(other.provisioningEvents().length).toBeGreaterThan(0)
  })
})

describe('the run renderer going away (AC10.3, TC50)', () => {
  it.each([
    ['is destroyed', (renderer: FakeWebContents) => renderer.destroy()],
    ['loses its render process', (renderer: FakeWebContents) => renderer.crash()],
    ['navigates its main frame', (renderer: FakeWebContents) => renderer.navigate(true)],
  ])('detaches the run as renderer-gone when the renderer %s', async (_, goAway) => {
    const harness = setup(duringInspection(({ renderer }) => goAway(renderer)))

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(envelope({ kind: 'unknown' }))
    expect(harness.detaches).toEqual(['renderer-gone'])
    expect(auditWrites(harness.device)).toEqual([expectedUnknownAudit(harness.device)])
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(harness.renderer.sentWhileDestroyed).toEqual([])
  })

  it('does not detach when only a sub-frame navigates', async () => {
    const harness = setup(duringInspection(({ renderer }) => renderer.navigate(false)))

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(
      envelope({ kind: 'connected-ready', operation: 'install' }),
    )
    expect(harness.detaches).toEqual([])
  })

  it('does not detach when another renderer goes away during the run', async () => {
    const harness = setup(duringInspection(({ other }) => other.destroy()))
    await harness.ipc.invoke(PROBE, harness.other, { host: '192.168.1.50', port: 22 })

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(
      envelope({ kind: 'connected-ready', operation: 'install' }),
    )
    expect(harness.detaches).toEqual([])
  })

  it('sends no end marker to a renderer destroyed during the run, and replies unknown with an end token', async () => {
    const harness = setup(duringInspection(({ renderer }) => renderer.destroy()))

    const reply = await harness.ipc.invoke(RUN, harness.renderer, REQUEST)

    expect(reply).toEqual({ outcome: { kind: 'unknown' }, endToken: runReply(reply).endToken })
    expect(harness.renderer.sentWhileDestroyed).toEqual([])
  })

  it('does not detach when the renderer goes away after the run ended', async () => {
    const { ipc, renderer, detaches } = setup()
    await ipc.invoke(RUN, renderer, REQUEST)

    renderer.destroy()

    expect(detaches).toEqual([])
  })
})

describe('quitting the editor (AC10.3, TC50)', () => {
  it('detaches a running operation as quit, with one audit entry for the outcome unknown', async () => {
    const quits: { prevented: boolean }[] = []
    const harness = setup(duringInspection(({ app }) => quits.push(app.quit())))

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(envelope({ kind: 'unknown' }))
    expect(harness.detaches).toEqual(['quit'])
    expect(auditWrites(harness.device)).toEqual([expectedUnknownAudit(harness.device)])
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(quits).toEqual([{ prevented: false }])
    expect(harness.cancels).toBe(0)
  })

  it('never blocks or cancels the quit when nothing runs', () => {
    const { app, cancels } = setup()

    expect(app.quit()).toEqual({ prevented: false })
    expect(cancels).toBe(0)
  })

  it('listens for the committed quit only, registering nothing on before-quit', () => {
    const { app } = setup()

    expect(app.listenerCount('before-quit')).toBe(0)
    expect(app.listenerCount('will-quit')).toBe(1)
  })

  it('leaves the operation running, with no audit entry, when another listener prevents the quit', async () => {
    const quits: { prevented: boolean }[] = []
    const harness = setup(
      duringInspection(({ app }) => {
        app.preventNextQuits()
        quits.push(app.quit())
      }),
    )

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(
      envelope({ kind: 'connected-ready', operation: 'install' }),
    )
    expect(quits).toEqual([{ prevented: true }])
    expect(harness.detaches).toEqual([])
  })

  it('ends the operation unknown on will-quit after a prevented quit, with one audit entry and the reason quit', async () => {
    const atPreventedQuit: { audits: number; detaches: number }[] = []
    const harness = setup(
      duringInspection((current) => {
        current.app.preventNextQuits()
        current.app.quit()
        atPreventedQuit.push({ audits: auditWrites(current.device).length, detaches: current.detaches.length })
        current.app.emit('will-quit')
      }),
    )

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(envelope({ kind: 'unknown' }))
    expect(atPreventedQuit).toEqual([{ audits: 0, detaches: 0 }])
    expect(harness.detaches).toEqual(['quit'])
    expect(auditWrites(harness.device)).toEqual([expectedUnknownAudit(harness.device)])
  })

  it('changes nothing on a second will-quit once the operation ended', async () => {
    const harness = setup(duringInspection(({ app }) => app.emit('will-quit')))
    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(envelope({ kind: 'unknown' }))
    const calls = harness.device.log.length

    harness.app.emit('will-quit')

    expect(harness.device.log).toHaveLength(calls)
    expect(auditWrites(harness.device)).toEqual([expectedUnknownAudit(harness.device)])
  })
})

describe('runtime-provisioning:cancel', () => {
  it('asks the service to cancel', async () => {
    const harness = setup()

    await expect(harness.ipc.invoke(CANCEL, harness.renderer)).resolves.toBeUndefined()
    expect(harness.cancels).toBe(1)
  })
})

describe('one operation at a time (AS-13a, M18, AC10.1)', () => {
  it('answers busy to a second run from any renderer, for the same or another host, opening no second session', async () => {
    const second: Promise<unknown>[] = []
    const harness = setup(
      duringInspection(({ ipc, renderer, other }) => {
        if (second.length > 0) return
        second.push(ipc.invoke(RUN, renderer, REQUEST), ipc.invoke(RUN, other, { ...REQUEST, host: '192.0.2.10' }))
      }),
    )

    await expect(harness.ipc.invoke(RUN, harness.renderer, REQUEST)).resolves.toEqual(
      envelope({ kind: 'connected-ready', operation: 'install' }),
    )
    await expect(Promise.all(second)).resolves.toEqual([envelope({ kind: 'busy' }), envelope({ kind: 'busy' })])
    expect(countOf(harness.device, 'open')).toBe(1)
    expect(auditWrites(harness.device)).toHaveLength(1)
  })

  it('keeps sending the running operation events to its own renderer after a busy call from another renderer', async () => {
    const busy: Promise<unknown>[] = []
    const harness = setup(
      duringInspection(({ ipc, other }) => {
        if (busy.length === 0) busy.push(ipc.invoke(RUN, other, REQUEST))
      }),
    )

    const owned = runReply(await harness.ipc.invoke(RUN, harness.renderer, REQUEST))
    const [busyValue] = await Promise.all(busy)
    const busyReply = runReply(busyValue)

    expect(busyReply.outcome).toEqual({ kind: 'busy' })
    expect(harness.renderer.provisioningEvents()).toEqual([
      ...harness.serviceEvents.map((event) => [event]),
      runEnd(owned.endToken),
    ])
    expect(harness.other.provisioningEvents()).toEqual([runEnd(busyReply.endToken)])
  })
})

describe('logging', () => {
  it('never prints a payload or a password', async () => {
    const printed: unknown[][] = []
    const record = (...args: unknown[]) => {
      printed.push(args)
    }
    jest.spyOn(console, 'log').mockImplementation(record)
    jest.spyOn(console, 'info').mockImplementation(record)
    jest.spyOn(console, 'warn').mockImplementation(record)
    jest.spyOn(console, 'error').mockImplementation(record)
    jest.spyOn(console, 'debug').mockImplementation(record)
    const { ipc, renderer } = setup()

    await ipc.invoke(RUN, renderer, { ...REQUEST, command: 'id' })
    await ipc.invoke(RUN, renderer, REQUEST)
    await ipc.invoke(PROBE, renderer, { host: '192.168.1.50', port: 22 })

    expect(JSON.stringify(printed)).not.toContain(DEVICE_PASSWORD)
    expect(JSON.stringify(printed)).not.toContain('commissioner42')
  })
})
