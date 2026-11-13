import type { PLCPou, PLCProjectData } from '@root/middleware/shared/ports/types'

import { parseArgs } from '../args'
import type { BuildRequest, CompiledProject, FailedBuild } from '../commands/build'
import { runSimulate, type SimulateDependencies, SIMULATOR_BOARD, type SimulatorRun } from '../commands/simulate'
import { ErrorCode, ExitCode } from '../exit-codes'
import { Reporter } from '../output'

const projectData = (pythonInstances: number): PLCProjectData => ({
  dataTypes: [],
  pous: [
    {
      name: 'PyBlock',
      pouType: 'function-block',
      interface: { variables: [] },
      body: { language: 'python', value: '' },
    },
    {
      name: 'main',
      pouType: 'program',
      interface: {
        variables: Array.from({ length: pythonInstances }, (_, n) => ({
          name: `py${n}`,
          class: 'local',
          type: { definition: 'derived', value: 'PyBlock' },
          location: '',
          documentation: '',
          debug: false,
        })),
      },
      body: { language: 'st', value: '' },
    },
  ] as PLCPou[],
  configurations: {
    resource: { tasks: [], instances: [{ name: 'i0', program: 'main', task: 't' }], globalVariables: [] },
  },
})

const compiled = (pythonInstances: number): CompiledProject => ({
  ok: true,
  project: {
    projectPath: '/projects/demo',
    name: 'demo',
    data: projectData(pythonInstances),
    compileReady: projectData(pythonInstances),
    board: 'OpenPLC Runtime v4',
    vendorScreenData: undefined,
    communicationPort: undefined,
    warnings: [],
  },
  target: SIMULATOR_BOARD,
  host: null,
  firmwarePath: '/projects/demo/build/OpenPLC Simulator/simulator.wasm',
  warnings: [],
})

class FakeSimulator implements SimulatorRun {
  onLog: SimulatorRun['onLog'] = null
  onStopped: SimulatorRun['onStopped'] = null
  readonly calls: string[] = []
  failLoad: Error | null = null

  preparePython(count: number): Promise<void> {
    this.calls.push(`prepare ${count}`)
    return Promise.resolve()
  }

  loadAndRun(module: Uint8Array): Promise<void> {
    this.calls.push(`run ${module.length}`)
    return this.failLoad ? Promise.reject(this.failLoad) : Promise.resolve()
  }

  stop(): void {
    this.calls.push('stop')
  }
}

function setUp(mode: 'json' | 'human', overrides: Partial<SimulateDependencies> = {}) {
  const out: string[] = []
  const err: string[] = []
  const reporter = new Reporter({ mode, streams: { out: (t) => out.push(t), err: (t) => err.push(t) } })
  const simulator = new FakeSimulator()
  const requests: BuildRequest[] = []
  let interrupt: () => void = () => undefined
  const interrupted = new Promise<void>((resolve) => (interrupt = resolve))
  const deps: SimulateDependencies = {
    build: (request) => {
      requests.push(request)
      return Promise.resolve(compiled(2))
    },
    readModule: () => Promise.resolve(new Uint8Array([0, 97, 115, 109])),
    createSimulator: () => simulator,
    loadPython: () => Promise.resolve({ ok: true, ms: 1 }),
    interrupted: () => interrupted,
    ...overrides,
  }
  return { out, err, reporter, simulator, requests, deps, interrupt }
}

const args = (...argv: string[]) => parseArgs(['simulate', ...argv], { booleanFlags: ['clean', 'json'] })

/** Resolves once `condition` holds, checking after each pending callback has run. */
async function until(condition: () => boolean): Promise<void> {
  for (let turn = 0; turn < 100 && !condition(); turn++) await new Promise((resolve) => setTimeout(resolve, 0))
  expect(condition()).toBe(true)
}

describe('openplc-cli simulate', () => {
  it('builds for the simulator, prepares one interpreter per Python block before the PLC, and prints the Console', async () => {
    const { out, err, reporter, simulator, requests, deps, interrupt } = setUp('human')
    const running = runSimulate(args('/projects/demo', '--clean'), reporter, deps)
    await until(() => simulator.onLog !== null && simulator.calls.length === 2)

    simulator.onLog?.('[PyBlock] count=1', 'stdout')
    simulator.onLog?.('[PyBlock] Traceback (most recent call last):', 'stderr')
    interrupt()
    const result = await running

    expect(requests).toEqual([
      expect.objectContaining({ target: SIMULATOR_BOARD, withUpload: false, compileOnly: false, cleanBuild: true }),
    ])
    expect(simulator.calls).toEqual(['prepare 2', 'run 4', 'stop'])
    expect(out[0]).toBe('[PyBlock] count=1\n')
    expect(err).toContain('[PyBlock] Traceback (most recent call last):\n')
    expect(out[1]).toMatch(/^Simulation of "demo" stopped after \d+\.\d s\.\n$/)
    expect(result.exitCode).toBe(ExitCode.Ok)
  })

  it('keeps stdout for the one result document in JSON mode', async () => {
    const { out, err, reporter, simulator, deps, interrupt } = setUp('json')
    const running = runSimulate(args('/projects/demo'), reporter, deps)
    await until(() => simulator.calls.length === 2)
    simulator.onLog?.('[PyBlock] count=1', 'stdout')
    interrupt()
    await running

    expect(out).toHaveLength(1)
    expect(JSON.parse(out[0])).toEqual(
      expect.objectContaining({ ok: true, project: 'demo', target: SIMULATOR_BOARD, pythonBlocks: 2 }),
    )
    expect(err).toContain('[PyBlock] count=1\n')
  })

  it('loads no Python for a project without Python blocks', async () => {
    const loadPython = jest.fn(() => Promise.resolve({ ok: true as const, ms: 1 }))
    const { reporter, simulator, deps, interrupt } = setUp('json', {
      build: () => Promise.resolve(compiled(0)),
      loadPython,
    })
    const running = runSimulate(args('/projects/demo'), reporter, deps)
    await until(() => simulator.calls.length === 1)
    interrupt()
    await running

    expect(loadPython).not.toHaveBeenCalled()
    expect(simulator.calls).toEqual(['run 4', 'stop'])
  })

  it('ends with the reason and a non-zero exit when the Python runtime cannot load', async () => {
    const { out, reporter, simulator, deps } = setUp('json', {
      loadPython: () => Promise.resolve({ ok: false, message: 'The Python runtime could not be loaded: missing' }),
    })
    const result = await runSimulate(args('/projects/demo'), reporter, deps)

    expect(JSON.parse(out[0])).toEqual({
      ok: false,
      error: { code: ErrorCode.SimulatorFailed, message: 'The Python runtime could not be loaded: missing' },
    })
    expect(result.exitCode).toBe(ExitCode.TargetError)
    expect(simulator.calls).toEqual([])
  })

  it('reports a module that cannot start', async () => {
    const { out, reporter, simulator, deps } = setUp('json')
    simulator.failLoad = new Error('bad module')
    const result = await runSimulate(args('/projects/demo'), reporter, deps)

    expect(JSON.parse(out[0]).error).toEqual({
      code: ErrorCode.SimulatorFailed,
      message: 'The simulator could not start: bad module',
    })
    expect(result.exitCode).toBe(ExitCode.TargetError)
    expect(simulator.calls).toEqual(['prepare 2', 'run 4', 'stop'])
  })

  it('fails with the reason when the run stops on its own', async () => {
    const { out, reporter, simulator, deps } = setUp('json')
    const running = runSimulate(args('/projects/demo'), reporter, deps)
    await until(() => simulator.calls.length === 2)
    simulator.onStopped?.('The simulator stopped: trap')
    const result = await running

    expect(JSON.parse(out[0]).error).toEqual({
      code: ErrorCode.SimulatorFailed,
      message: 'The simulator stopped: trap',
    })
    expect(result.exitCode).toBe(ExitCode.TargetError)
  })

  it('passes a failed build through, and needs a project', async () => {
    const failed: FailedBuild = { ok: false, result: { exitCode: ExitCode.CompileFailed } }
    const { reporter, deps } = setUp('json', { build: () => Promise.resolve(failed) })
    expect((await runSimulate(args('/projects/demo'), reporter, deps)).exitCode).toBe(ExitCode.CompileFailed)

    const missing = setUp('json')
    const result = await runSimulate(args(), missing.reporter, missing.deps)
    expect(JSON.parse(missing.out[0]).error.code).toBe(ErrorCode.MissingArgument)
    expect(result.exitCode).toBe(ExitCode.Usage)
  })

  it('exits as interrupted, without running, when Ctrl+C arrives during the build', async () => {
    const { out, reporter, simulator, deps, interrupt } = setUp('json', { build: () => new Promise(() => undefined) })
    const running = runSimulate(args('/projects/demo'), reporter, deps)
    interrupt()
    const result = await running

    expect(JSON.parse(out[0]).error.code).toBe(ErrorCode.Interrupted)
    expect(result.exitCode).toBe(ExitCode.Interrupted)
    expect(simulator.calls).toEqual([])
  })

  it('stops the simulator when Ctrl+C arrives while its interpreters are being prepared', async () => {
    const { out, reporter, simulator, deps, interrupt } = setUp('json')
    simulator.preparePython = (count) => {
      simulator.calls.push(`prepare ${count}`)
      return new Promise(() => undefined)
    }
    const running = runSimulate(args('/projects/demo'), reporter, deps)
    await until(() => simulator.calls.length === 1)
    interrupt()
    const result = await running

    expect(JSON.parse(out[0]).error.code).toBe(ErrorCode.Interrupted)
    expect(result.exitCode).toBe(ExitCode.Interrupted)
    expect(simulator.calls).toEqual(['prepare 2', 'stop'])
  })

  it('refuses a build that produced no module', async () => {
    const { out, reporter, deps } = setUp('json', {
      build: () => Promise.resolve({ ...compiled(0), firmwarePath: undefined }),
    })
    const result = await runSimulate(args('/projects/demo'), reporter, deps)
    expect(JSON.parse(out[0]).error.code).toBe(ErrorCode.CompileFailed)
    expect(result.exitCode).toBe(ExitCode.CompileFailed)
  })
})
