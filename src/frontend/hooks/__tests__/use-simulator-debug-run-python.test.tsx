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
    },
  })
  const debugSession = {} as UseDebugSessionReturn
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
