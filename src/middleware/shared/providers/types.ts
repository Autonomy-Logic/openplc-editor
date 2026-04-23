/**
 * Aggregate type that groups all port interfaces + platform capabilities.
 * This is the shape of the value provided by PlatformContext.
 */

import type { AcceleratorPort } from '../ports/accelerator-port'
import type { AIPort } from '../ports/ai-port'
import type { CompilerPort } from '../ports/compiler-port'
import type { DebuggerPort } from '../ports/debugger-port'
import type { DevicePort } from '../ports/device-port'
import type { EsiPort } from '../ports/esi-port'
import type { OrchestratorPort } from '../ports/orchestrator-port'
import type { PackagePort } from '../ports/package-port'
import type { PlatformCapabilities } from '../ports/platform-capabilities'
import type { ProjectPort } from '../ports/project-port'
import type { RuntimePort } from '../ports/runtime-port'
import type { SimulatorPort } from '../ports/simulator-port'
import type { SystemPort } from '../ports/system-port'
import type { ThemePort } from '../ports/theme-port'
import type { VersionControlPort } from '../ports/version-control-port'
import type { WindowPort } from '../ports/window-port'

export interface PlatformPorts {
  compiler: CompilerPort
  runtime: RuntimePort
  debugger: DebuggerPort
  simulator: SimulatorPort
  project: ProjectPort
  device: DevicePort
  orchestrator: OrchestratorPort
  system: SystemPort
  window: WindowPort
  accelerator: AcceleratorPort
  theme: ThemePort
  versionControl: VersionControlPort
  capabilities: PlatformCapabilities
  packages?: PackagePort
  esi?: EsiPort
  ai?: AIPort
}
