import type { AcceleratorPort } from '../ports/accelerator-port'
import type { AIPort } from '../ports/ai-port'
import type { CompilerPort } from '../ports/compiler-port'
import type { DebuggerPort } from '../ports/debugger-port'
import type { DevicePort } from '../ports/device-port'
import type { EdgeAccountPort } from '../ports/edge-account-port'
import type { EditSessionPort } from '../ports/edit-session-port'
import type { EsiPort } from '../ports/esi-port'
import type { EtherCATScanPort } from '../ports/ethercat-scan-port'
import type { LibraryPort } from '../ports/library-port'
import type { NavigationPort } from '../ports/navigation-port'
import type { OrchestratorPort } from '../ports/orchestrator-port'
import type { PackagePort } from '../ports/package-port'
import type { PlatformCapabilities } from '../ports/platform-capabilities'
import type { ProjectPort } from '../ports/project-port'
import type { RuntimePort } from '../ports/runtime-port'
import type { SimulatorPort } from '../ports/simulator-port'
import type { StlibSourcePort } from '../ports/stlib-source-port'
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
  navigation: NavigationPort
  library: LibraryPort
  capabilities: PlatformCapabilities
  packages?: PackagePort
  esi?: EsiPort
  /** DOPE-704 E6: scan modules on a modular coupler via EtherDOG's 0xF050 path. */
  ethercatScan?: EtherCATScanPort
  ai?: AIPort
  // Gate on `capabilities.hasEdgeAccount`, not on presence: autonomy-node has no Edge account API.
  edgeAccount?: EdgeAccountPort
  editSession?: EditSessionPort
  // Required when `capabilities.hasStLSP` is true.
  stlibSource?: StlibSourcePort
}
