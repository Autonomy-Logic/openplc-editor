import { createContext, type ReactNode, useContext } from 'react'

import type { PlatformPorts } from './types'

/**
 * React context that provides platform port implementations to the component tree.
 *
 * Usage:
 *   // In a component:
 *   const { compiler, runtime, capabilities } = usePlatform()
 *   await compiler.compileProgram(args, onProgress)
 *   if (capabilities.isNativeApplication) { ... }
 *
 * Wiring:
 *   // At the app root (editor):
 *   <PlatformProvider ports={editorPorts}>
 *     <App />
 *   </PlatformProvider>
 *
 *   // At the app root (web):
 *   <PlatformProvider ports={webPorts}>
 *     <RouterProvider router={router} />
 *   </PlatformProvider>
 */
const PlatformContext = createContext<PlatformPorts | null>(null)

interface PlatformProviderProps {
  ports: PlatformPorts
  children: ReactNode
}

export function PlatformProvider({ ports, children }: PlatformProviderProps) {
  return <PlatformContext.Provider value={ports}>{children}</PlatformContext.Provider>
}

/**
 * Hook to access platform ports from any component in the tree.
 * Throws if used outside a PlatformProvider — this is intentional
 * to catch wiring mistakes early during development.
 */
export function usePlatform(): PlatformPorts {
  const context = useContext(PlatformContext)
  if (!context) {
    throw new Error('usePlatform must be used within a PlatformProvider. Did you forget to wrap your app root?')
  }
  return context
}

/**
 * Convenience hooks for accessing individual ports.
 * These avoid destructuring when only one port is needed.
 */
export function useCompiler() {
  return usePlatform().compiler
}

export function useRuntime() {
  return usePlatform().runtime
}

export function useDebugger() {
  return usePlatform().debugger
}

export function useSimulator() {
  return usePlatform().simulator
}

export function useProject() {
  return usePlatform().project
}

export function useDevice() {
  return usePlatform().device
}

export function useOrchestrator() {
  return usePlatform().orchestrator
}

export function useSystem() {
  return usePlatform().system
}

export function useWindow() {
  return usePlatform().window
}

export function useAccelerator() {
  return usePlatform().accelerator
}

export function useTheme() {
  return usePlatform().theme
}

export function useVersionControl() {
  return usePlatform().versionControl
}

export function useNavigation() {
  return usePlatform().navigation
}

export function useCapabilities() {
  return usePlatform().capabilities
}

export function useAI() {
  return usePlatform().ai
}

export function usePackages() {
  return usePlatform().packages
}

export function useEsi() {
  return usePlatform().esi
}

export function useLibrary() {
  return usePlatform().library
}

export function useStlibSource() {
  return usePlatform().stlibSource
}
