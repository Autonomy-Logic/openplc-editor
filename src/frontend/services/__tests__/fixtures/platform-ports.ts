import type { AcceleratorPort } from '../../../../middleware/shared/ports/accelerator-port'
import type { CompilerPort } from '../../../../middleware/shared/ports/compiler-port'
import type { DebuggerPort } from '../../../../middleware/shared/ports/debugger-port'
import type { DevicePort } from '../../../../middleware/shared/ports/device-port'
import type { LibraryPort } from '../../../../middleware/shared/ports/library-port'
import type { NavigationPort } from '../../../../middleware/shared/ports/navigation-port'
import type { OrchestratorPort } from '../../../../middleware/shared/ports/orchestrator-port'
import { EDITOR_CAPABILITIES } from '../../../../middleware/shared/ports/platform-capabilities'
import type { ProjectPort } from '../../../../middleware/shared/ports/project-port'
import type { RuntimePort } from '../../../../middleware/shared/ports/runtime-port'
import type { RuntimeProvisioningPort } from '../../../../middleware/shared/ports/runtime-provisioning-port'
import type { SimulatorPort } from '../../../../middleware/shared/ports/simulator-port'
import type { SystemPort } from '../../../../middleware/shared/ports/system-port'
import type { ThemePort } from '../../../../middleware/shared/ports/theme-port'
import type { Unsubscribe } from '../../../../middleware/shared/ports/types'
import type { VersionControlPort } from '../../../../middleware/shared/ports/version-control-port'
import type { WindowPort } from '../../../../middleware/shared/ports/window-port'
import type { PlatformPorts } from '../../../../middleware/shared/providers/types'
import type { PortCallLog } from './runtime-ports'

export interface ProvisioningPlatformPorts {
  runtime: RuntimePort
  device: DevicePort
  runtimeProvisioning: RuntimeProvisioningPort
}

function note(log: PortCallLog, member: string): void {
  const call = `unexpected ${member}`
  log.calls.push(call)
  log.onCall?.(call)
}

function rejects(log: PortCallLog, member: string): Promise<never> {
  note(log, member)
  return Promise.reject(new Error(`unexpected call to ${member}`))
}

function throws(log: PortCallLog, member: string): never {
  note(log, member)
  throw new Error(`unexpected call to ${member}`)
}

function subscribes(log: PortCallLog, member: string): Unsubscribe {
  note(log, member)
  return () => undefined
}

function compilerPort(log: PortCallLog): CompilerPort {
  return {
    compileProgram: () => rejects(log, 'compiler.compileProgram'),
    compileForDebug: () => rejects(log, 'compiler.compileForDebug'),
    compileToWasm: () => rejects(log, 'compiler.compileToWasm'),
  }
}

function debuggerPort(log: PortCallLog): DebuggerPort {
  return {
    connect: () => rejects(log, 'debugger.connect'),
    disconnect: () => rejects(log, 'debugger.disconnect'),
    getVariablesList: () => rejects(log, 'debugger.getVariablesList'),
    setVariable: () => rejects(log, 'debugger.setVariable'),
    verifyMd5: () => rejects(log, 'debugger.verifyMd5'),
    readProgramMd5: () => rejects(log, 'debugger.readProgramMd5'),
    readDebugFile: () => rejects(log, 'debugger.readDebugFile'),
    onDisconnected: () => subscribes(log, 'debugger.onDisconnected'),
    isConnected: () => throws(log, 'debugger.isConnected'),
  }
}

function simulatorPort(log: PortCallLog): SimulatorPort {
  return {
    loadFirmware: () => rejects(log, 'simulator.loadFirmware'),
    stop: () => rejects(log, 'simulator.stop'),
    isRunning: () => throws(log, 'simulator.isRunning'),
    onStopped: () => subscribes(log, 'simulator.onStopped'),
    connectDebugger: () => rejects(log, 'simulator.connectDebugger'),
    disconnectDebugger: () => note(log, 'simulator.disconnectDebugger'),
    getDebugMd5Hash: () => rejects(log, 'simulator.getDebugMd5Hash'),
    getDebugVariablesList: () => rejects(log, 'simulator.getDebugVariablesList'),
    setDebugVariable: () => rejects(log, 'simulator.setDebugVariable'),
  }
}

function projectPort(log: PortCallLog): ProjectPort {
  return {
    createProject: () => rejects(log, 'project.createProject'),
    openProject: () => rejects(log, 'project.openProject'),
    openProjectByPath: () => rejects(log, 'project.openProjectByPath'),
    saveProject: () => rejects(log, 'project.saveProject'),
    saveFile: () => rejects(log, 'project.saveFile'),
    createPou: () => rejects(log, 'project.createPou'),
    deletePou: () => rejects(log, 'project.deletePou'),
    renamePou: () => rejects(log, 'project.renamePou'),
    renameProject: () => rejects(log, 'project.renameProject'),
    pickPath: () => rejects(log, 'project.pickPath'),
    getRecentProjects: () => rejects(log, 'project.getRecentProjects'),
    removeRecentProject: () => rejects(log, 'project.removeRecentProject'),
    deleteProject: () => rejects(log, 'project.deleteProject'),
    readFileContent: () => rejects(log, 'project.readFileContent'),
    readProjectFiles: () => rejects(log, 'project.readProjectFiles'),
    pickPlcopenImportFile: () => rejects(log, 'project.pickPlcopenImportFile'),
    exportPlcopenFile: () => rejects(log, 'project.exportPlcopenFile'),
    exportPdfFile: () => rejects(log, 'project.exportPdfFile'),
    renderPdf: () => rejects(log, 'project.renderPdf'),
    preparePdfPreviewWorker: () => rejects(log, 'project.preparePdfPreviewWorker'),
  }
}

function orchestratorPort(log: PortCallLog): OrchestratorPort {
  return {
    listOrchestrators: () => rejects(log, 'orchestrator.listOrchestrators'),
  }
}

function systemPort(log: PortCallLog): SystemPort {
  return {
    getSystemInfo: () => rejects(log, 'system.getSystemInfo'),
    getStoreValue: () => rejects(log, 'system.getStoreValue'),
    setStoreValue: () => note(log, 'system.setStoreValue'),
    openExternalLink: () => rejects(log, 'system.openExternalLink'),
    log: () => note(log, 'system.log'),
    getEdgeFrontendUrl: () => throws(log, 'system.getEdgeFrontendUrl'),
  }
}

function windowPort(log: PortCallLog): WindowPort {
  return {
    minimize: () => note(log, 'window.minimize'),
    maximize: () => note(log, 'window.maximize'),
    close: () => note(log, 'window.close'),
    hide: () => note(log, 'window.hide'),
    reload: () => note(log, 'window.reload'),
    requestQuit: () => note(log, 'window.requestQuit'),
    quit: () => note(log, 'window.quit'),
    rebuildMenu: () => note(log, 'window.rebuildMenu'),
    onCloseRequested: () => subscribes(log, 'window.onCloseRequested'),
  }
}

function acceleratorPort(log: PortCallLog): AcceleratorPort {
  return {
    onCreateProject: () => subscribes(log, 'accelerator.onCreateProject'),
    onOpenProject: () => subscribes(log, 'accelerator.onOpenProject'),
    onOpenRecent: () => subscribes(log, 'accelerator.onOpenRecent'),
    onSaveProject: () => subscribes(log, 'accelerator.onSaveProject'),
    onSaveProjectAs: () => subscribes(log, 'accelerator.onSaveProjectAs'),
    onSaveFile: () => subscribes(log, 'accelerator.onSaveFile'),
    onRetrieveProject: () => subscribes(log, 'accelerator.onRetrieveProject'),
    onImportPlcopen: () => subscribes(log, 'accelerator.onImportPlcopen'),
    onCloseProject: () => subscribes(log, 'accelerator.onCloseProject'),
    onExportProject: () => subscribes(log, 'accelerator.onExportProject'),
    onPrint: () => subscribes(log, 'accelerator.onPrint'),
    onPageSetup: () => subscribes(log, 'accelerator.onPageSetup'),
    onCloseTab: () => subscribes(log, 'accelerator.onCloseTab'),
    onDeleteFile: () => subscribes(log, 'accelerator.onDeleteFile'),
    onFindInProject: () => subscribes(log, 'accelerator.onFindInProject'),
    onUndo: () => subscribes(log, 'accelerator.onUndo'),
    onRedo: () => subscribes(log, 'accelerator.onRedo'),
    onSwitchPerspective: () => subscribes(log, 'accelerator.onSwitchPerspective'),
    onAbout: () => subscribes(log, 'accelerator.onAbout'),
    onQuitApp: () => subscribes(log, 'accelerator.onQuitApp'),
    onRefresh: () => subscribes(log, 'accelerator.onRefresh'),
  }
}

function themePort(log: PortCallLog): ThemePort {
  return {
    getCurrentTheme: () => throws(log, 'theme.getCurrentTheme'),
    setTheme: () => note(log, 'theme.setTheme'),
    toggleTheme: () => note(log, 'theme.toggleTheme'),
    onThemeChanged: () => subscribes(log, 'theme.onThemeChanged'),
  }
}

function versionControlPort(log: PortCallLog): VersionControlPort {
  return {
    listBranches: () => rejects(log, 'versionControl.listBranches'),
    createBranch: () => rejects(log, 'versionControl.createBranch'),
    deleteBranch: () => rejects(log, 'versionControl.deleteBranch'),
    switchBranch: () => rejects(log, 'versionControl.switchBranch'),
    previewSwitchCarry: () => rejects(log, 'versionControl.previewSwitchCarry'),
    listCommits: () => rejects(log, 'versionControl.listCommits'),
    createCommit: () => rejects(log, 'versionControl.createCommit'),
    getCommitFiles: () => rejects(log, 'versionControl.getCommitFiles'),
    restoreCommit: () => rejects(log, 'versionControl.restoreCommit'),
    getChanges: () => rejects(log, 'versionControl.getChanges'),
    discardChanges: () => rejects(log, 'versionControl.discardChanges'),
    listStashes: () => rejects(log, 'versionControl.listStashes'),
    createStash: () => rejects(log, 'versionControl.createStash'),
    applyStash: () => rejects(log, 'versionControl.applyStash'),
    popStash: () => rejects(log, 'versionControl.popStash'),
    dropStash: () => rejects(log, 'versionControl.dropStash'),
    computeGraphicalDiff: () => throws(log, 'versionControl.computeGraphicalDiff'),
  }
}

function navigationPort(log: PortCallLog): NavigationPort {
  return {
    navigate: () => note(log, 'navigation.navigate'),
    openInNewWindow: () => note(log, 'navigation.openInNewWindow'),
    exitToHost: () => note(log, 'navigation.exitToHost'),
  }
}

function libraryPort(log: PortCallLog): LibraryPort {
  return {
    loadAll: () => rejects(log, 'library.loadAll'),
    listInstalled: () => rejects(log, 'library.listInstalled'),
    installFromFile: () => rejects(log, 'library.installFromFile'),
    uninstall: () => rejects(log, 'library.uninstall'),
    onLibrariesChanged: () => subscribes(log, 'library.onLibrariesChanged'),
  }
}

export function createPlatformPorts(log: PortCallLog, provisioning: ProvisioningPlatformPorts): PlatformPorts {
  return {
    compiler: compilerPort(log),
    runtime: provisioning.runtime,
    debugger: debuggerPort(log),
    simulator: simulatorPort(log),
    project: projectPort(log),
    device: provisioning.device,
    orchestrator: orchestratorPort(log),
    system: systemPort(log),
    window: windowPort(log),
    accelerator: acceleratorPort(log),
    theme: themePort(log),
    versionControl: versionControlPort(log),
    navigation: navigationPort(log),
    library: libraryPort(log),
    capabilities: EDITOR_CAPABILITIES,
    runtimeProvisioning: provisioning.runtimeProvisioning,
  }
}
