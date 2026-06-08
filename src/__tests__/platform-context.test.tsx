import { renderHook } from '@testing-library/react'
import { type ReactNode } from 'react'

import { EDITOR_CAPABILITIES } from '../middleware/shared/ports/platform-capabilities'
import {
  PlatformProvider,
  useAccelerator,
  useCapabilities,
  useCompiler,
  useDebugger,
  useDevice,
  usePlatform,
  useProject,
  useRuntime,
  useSimulator,
  useSystem,
  useTheme,
  useWindow,
} from '../middleware/shared/providers'
import type { PlatformPorts } from '../middleware/shared/providers/types'

function createStubPort<T extends object>(): T {
  return new Proxy({} as T, {
    get(_, prop) {
      if (typeof prop === 'string') return () => undefined
      return undefined
    },
  })
}

const testPorts: PlatformPorts = {
  compiler: createStubPort(),
  runtime: createStubPort(),
  debugger: createStubPort(),
  simulator: createStubPort(),
  project: createStubPort(),
  device: createStubPort(),
  orchestrator: createStubPort(),
  system: createStubPort(),
  window: createStubPort(),
  accelerator: createStubPort(),
  theme: createStubPort(),
  versionControl: createStubPort(),
  navigation: createStubPort(),
  library: createStubPort(),
  capabilities: EDITOR_CAPABILITIES,
}

function wrapper({ children }: { children: ReactNode }) {
  return <PlatformProvider ports={testPorts}>{children}</PlatformProvider>
}

describe('PlatformProvider', () => {
  it('provides platform ports via usePlatform', () => {
    const { result } = renderHook(() => usePlatform(), { wrapper })
    expect(result.current).toBe(testPorts)
  })

  it('throws when usePlatform is used outside PlatformProvider', () => {
    // Suppress expected React error boundary console output
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => usePlatform())).toThrow('usePlatform must be used within a PlatformProvider')
    spy.mockRestore()
  })
})

describe('Convenience hooks', () => {
  it('useCompiler returns compiler port', () => {
    const { result } = renderHook(() => useCompiler(), { wrapper })
    expect(result.current).toBe(testPorts.compiler)
  })

  it('useRuntime returns runtime port', () => {
    const { result } = renderHook(() => useRuntime(), { wrapper })
    expect(result.current).toBe(testPorts.runtime)
  })

  it('useDebugger returns debugger port', () => {
    const { result } = renderHook(() => useDebugger(), { wrapper })
    expect(result.current).toBe(testPorts.debugger)
  })

  it('useSimulator returns simulator port', () => {
    const { result } = renderHook(() => useSimulator(), { wrapper })
    expect(result.current).toBe(testPorts.simulator)
  })

  it('useProject returns project port', () => {
    const { result } = renderHook(() => useProject(), { wrapper })
    expect(result.current).toBe(testPorts.project)
  })

  it('useDevice returns device port', () => {
    const { result } = renderHook(() => useDevice(), { wrapper })
    expect(result.current).toBe(testPorts.device)
  })

  it('useSystem returns system port', () => {
    const { result } = renderHook(() => useSystem(), { wrapper })
    expect(result.current).toBe(testPorts.system)
  })

  it('useWindow returns window port', () => {
    const { result } = renderHook(() => useWindow(), { wrapper })
    expect(result.current).toBe(testPorts.window)
  })

  it('useAccelerator returns accelerator port', () => {
    const { result } = renderHook(() => useAccelerator(), { wrapper })
    expect(result.current).toBe(testPorts.accelerator)
  })

  it('useTheme returns theme port', () => {
    const { result } = renderHook(() => useTheme(), { wrapper })
    expect(result.current).toBe(testPorts.theme)
  })

  it('useCapabilities returns capabilities', () => {
    const { result } = renderHook(() => useCapabilities(), { wrapper })
    expect(result.current).toBe(EDITOR_CAPABILITIES)
  })
})
