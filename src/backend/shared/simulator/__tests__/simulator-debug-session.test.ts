/**
 * The simulator run and its debugger as the web host relays them, against the real fixture module.
 * @jest-environment node
 * @vitest-environment node
 */
import { afterEach, describe, expect, it } from '@jest/globals'

import { decodeSimulatorFirmware, encodeSimulatorFirmware, SimulatorDebugSession } from '../simulator-debug-session'
import { hostModule } from './fixtures/host-module'
import { debugIndex, FIXTURE_MD5, fixtureModule } from './fixtures/simulator-fixture'
import { OP } from './fixtures/tiny-wasm'

const sessions: SimulatorDebugSession[] = []
const session = (): SimulatorDebugSession => {
  const created = new SimulatorDebugSession()
  sessions.push(created)
  return created
}

afterEach(() => {
  for (const created of sessions.splice(0)) created.stop()
})

describe('SimulatorDebugSession', () => {
  it('runs the module and answers the debugger with hex data, forcing from hex values', async () => {
    const run = session()
    await run.start(fixtureModule())
    expect(run.isRunning()).toBe(true)
    await run.connectDebugger()

    await expect(run.getMd5Hash()).resolves.toBe(FIXTURE_MD5)
    await expect(run.setVariable(debugIndex('INSTANCE0.FORCE_ME'), true, '01')).resolves.toEqual({ success: true })
    let mirror = ''
    for (let tries = 0; tries < 200 && mirror !== '01'; tries++) {
      const result = await run.getVariablesList([debugIndex('INSTANCE0.MIRROR')])
      expect(result.success).toBe(true)
      mirror = result.data ?? ''
    }
    expect(mirror).toBe('01')
    await expect(run.setVariable(debugIndex('INSTANCE0.FORCE_ME'), false)).resolves.toEqual({ success: true })
  })

  it('refuses debugger calls before the debugger connects, and a connect with nothing running', async () => {
    const run = session()
    await expect(run.connectDebugger()).rejects.toThrow('Simulator is not running')
    await expect(run.getMd5Hash()).rejects.toThrow('Debugger not connected')
    await expect(run.getVariablesList([0])).resolves.toEqual({ success: false, error: 'Debugger not connected' })
    await expect(run.setVariable(0, false)).resolves.toEqual({ success: false, error: 'Debugger not connected' })
  })

  it('leaves nothing running when the module cannot start', async () => {
    const run = session()
    await expect(run.start(new Uint8Array([0, 1, 2]))).rejects.toThrow()
    expect(run.isRunning()).toBe(false)
  })

  it('ends a first run when a second one starts, and reports a run that ends on its own', async () => {
    const run = session()
    const lines: string[] = []
    run.onLog = (line) => lines.push(line)
    await run.start(fixtureModule())
    await run.start(hostModule({ periodUs: 1000, loop: [OP.unreachable] }))
    expect(lines).toContain('hi')

    const reason = await new Promise<string>((resolve) => {
      run.onStopped = resolve
    })
    expect(reason).toMatch(/^The simulator stopped: /)
    expect(run.isRunning()).toBe(false)
  })

  it('carries the module as text with one character per byte, and back', () => {
    const module = new Uint8Array([0, 97, 115, 109, 255, 128])
    expect(decodeSimulatorFirmware(encodeSimulatorFirmware(module))).toEqual(module)
  })
})
