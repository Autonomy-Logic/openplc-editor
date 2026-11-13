import { createStoreWrapper, createTestPorts, createTestStore } from '@root/frontend/store/testing'
import { EDITOR_CAPABILITIES } from '@root/middleware/shared/ports/platform-capabilities'
import type { PLCPou, PLCProjectData } from '@root/middleware/shared/ports/types'
import { act, renderHook } from '@testing-library/react'

import { useSimulatorDebugRun } from '../use-simulator-debug-run'
import type { UseDebugSessionReturn } from '../useDebugSession'

const pythonProject = (instances: number): PLCProjectData => ({
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
        variables: Array.from({ length: instances }, (_, n) => ({
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

function setUp(
  preparePython: (count: number) => Promise<void>,
  loadFirmware: () => Promise<{ success: boolean }> = () => Promise.resolve({ success: true }),
  stop: () => Promise<{ success: boolean }> = () => Promise.resolve({ success: true }),
) {
  const store = createTestStore()
  let emit: (line: string, stream: 'stdout' | 'stderr') => void = () => undefined
  const ports = createTestPorts({
    capabilities: EDITOR_CAPABILITIES,
    simulator: {
      onStopped: () => () => undefined,
      onLog: (callback) => {
        emit = callback
        return () => undefined
      },
      preparePython,
      loadFirmware,
      stop,
    },
  })
  const debugSession = { stopSession: () => Promise.resolve() } as unknown as UseDebugSessionReturn
  const { result } = renderHook(() => useSimulatorDebugRun({ debugSession }), {
    wrapper: createStoreWrapper(store, ports),
  })
  return { store, result, emit: (line: string, stream: 'stdout' | 'stderr') => emit(line, stream) }
}

describe('useSimulatorDebugRun and Python blocks', () => {
  it('puts the run output on the Console, stderr as errors', () => {
    const { store, emit } = setUp(() => Promise.resolve())
    act(() => {
      emit('[PyBlock] count=1', 'stdout')
      emit('[PyBlock] Traceback (most recent call last):', 'stderr')
    })
    expect(store.getState().logs.slice(-2)).toEqual([
      expect.objectContaining({ level: 'info', message: '[PyBlock] count=1' }),
      expect.objectContaining({ level: 'error', message: '[PyBlock] Traceback (most recent call last):' }),
    ])
  })

  it('starts one interpreter per Python block instance before the PLC, and none for a project without any', async () => {
    const order: string[] = []
    const preparePython = jest.fn((count: number) => {
      order.push(`prepare ${count}`)
      return Promise.resolve()
    })
    const loadFirmware = jest.fn(() => {
      order.push('load')
      return Promise.resolve({ success: true })
    })
    const { result } = setUp(preparePython, loadFirmware)
    await act(() => result.current.launch('module', { projectData: pythonProject(3) }))
    await act(() => result.current.launch('module', { projectData: pythonProject(0) }))
    await act(() => result.current.launch('module'))
    expect(order).toEqual(['prepare 3', 'load', 'load', 'load'])
  })

  it('is busy from launch until the run has started, and from stop until it has stopped', async () => {
    let releasePython: () => void = () => undefined
    const preparing = new Promise<void>((resolve) => (releasePython = resolve))
    let releaseStop: () => void = () => undefined
    const stopping = new Promise<{ success: boolean }>((resolve) => (releaseStop = () => resolve({ success: true })))
    const { result } = setUp(
      () => preparing,
      () => Promise.resolve({ success: true }),
      () => stopping,
    )
    expect(result.current.isBusy).toBe(false)

    let launched: Promise<boolean> = Promise.resolve(false)
    act(() => {
      launched = result.current.launch('module', { projectData: pythonProject(1) })
    })
    expect(result.current.isBusy).toBe(true)
    await act(async () => {
      releasePython()
      await launched
    })
    expect(result.current.isBusy).toBe(false)
    expect(result.current.isRunning).toBe(true)

    let stopped: Promise<void> = Promise.resolve()
    act(() => {
      stopped = result.current.stop()
    })
    expect(result.current.isBusy).toBe(true)
    await act(async () => {
      releaseStop()
      await stopped
    })
    expect(result.current.isBusy).toBe(false)
    expect(result.current.isRunning).toBe(false)
  })

  it('is not busy after a launch that fails', async () => {
    const { result } = setUp(
      () => Promise.resolve(),
      () => Promise.resolve({ success: false }),
    )
    await act(() => result.current.launch('module'))
    expect(result.current.isBusy).toBe(false)
    expect(result.current.isRunning).toBe(false)
  })

  it('reports interpreters that cannot be prepared and still starts the PLC', async () => {
    const loadFirmware = jest.fn(() => Promise.resolve({ success: true }))
    const { store, result } = setUp(() => Promise.reject(new Error('runtime gone')), loadFirmware)
    await act(() => result.current.launch('module', { projectData: pythonProject(1) }))
    expect(store.getState().logs).toContainEqual(
      expect.objectContaining({ level: 'error', message: 'Python could not be prepared: runtime gone' }),
    )
    expect(loadFirmware).toHaveBeenCalled()
  })
})
