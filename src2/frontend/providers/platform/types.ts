/**
 * Aggregate type that groups all port interfaces + platform capabilities.
 * This is the shape of the value provided by PlatformContext.
 */

import type { CompilerPort } from './ports/compiler-port'
import type { RuntimePort } from './ports/runtime-port'
import type { DebuggerPort } from './ports/debugger-port'
import type { SimulatorPort } from './ports/simulator-port'
import type { ProjectPort } from './ports/project-port'
import type { DevicePort } from './ports/device-port'
import type { SystemPort } from './ports/system-port'
import type { WindowPort } from './ports/window-port'
import type { AcceleratorPort } from './ports/accelerator-port'
import type { ThemePort } from './ports/theme-port'
import type { PlatformCapabilities } from './ports/platform-capabilities'

export interface PlatformPorts {
  compiler: CompilerPort
  runtime: RuntimePort
  debugger: DebuggerPort
  simulator: SimulatorPort
  project: ProjectPort
  device: DevicePort
  system: SystemPort
  window: WindowPort
  accelerator: AcceleratorPort
  theme: ThemePort
  capabilities: PlatformCapabilities
}
