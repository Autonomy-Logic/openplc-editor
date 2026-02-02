import { useOpenPLCStore } from '@root/renderer/store'
import { RemoteDeviceIOPoint } from '@root/renderer/utils/remote-device-options'
import { PLCPou } from '@root/types/PLC/open-plc'
import { useShallow } from 'zustand/react/shallow'

// ===================== Device screen selectors. =====================
const rtuSelectors = {
  useAvailableRTUInterfaces: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableRTUInterfaces),
  useAvailableRTUBaudRates: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableRTUBaudRates),
  useModbusRTU: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusRTU),
  useSetRTUConfig: () => useOpenPLCStore((state) => state.deviceActions.setRTUConfig),
}

const tcpSelectors = {
  useAvailableTCPInterfaces: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableTCPInterfaces),
  useModbusTCP: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusTCP),
  useSetTCPConfig: () => useOpenPLCStore((state) => state.deviceActions.setTCPConfig),
  useSetWifiConfig: () => useOpenPLCStore((state) => state.deviceActions.setWifiConfig),
}

const staticHostSelectors = {
  useTcpStaticHostConfiguration: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration,
    ),
  useSetStaticHostConfiguration: () => useOpenPLCStore((state) => state.deviceActions.setStaticHostConfiguration),
}

const boardSelectors = {
  useAvailableBoards: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableBoards),
  useAvailableCommunicationPorts: () =>
    useOpenPLCStore((state) => state.deviceAvailableOptions.availableCommunicationPorts),
  useDeviceBoard: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard),
  useCommunicationPort: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationPort),
  useSetDeviceBoard: () => useOpenPLCStore((state) => state.deviceActions.setDeviceBoard),
  useSetCommunicationPort: () => useOpenPLCStore((state) => state.deviceActions.setCommunicationPort),
  useSetAvailableOptions: () => useOpenPLCStore((state) => state.deviceActions.setAvailableOptions),
}

const pinSelectors = {
  usePins: () => useOpenPLCStore((state) => state.deviceDefinitions.pinMapping.pins),
  useCreateNewPin: () => useOpenPLCStore((state) => state.deviceActions.createNewPin),
  useRemovePin: () => useOpenPLCStore((state) => state.deviceActions.removePin),
  useUpdatePin: () => useOpenPLCStore((state) => state.deviceActions.updatePin),
  useSelectPinTableRow: () => useOpenPLCStore((state) => state.deviceActions.selectPinTableRow),
  useCurrentSelectedPinTableRow: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.pinMapping.currentSelectedPinTableRow),
}

const deviceSelectors = {
  useDeviceUpdated: () => useOpenPLCStore((state) => state.deviceUpdated.updated),
  useResetDeviceUpdated: () => useOpenPLCStore((state) => state.deviceActions.resetDeviceUpdated),
}

const compileOnlySelectors = {
  useCompileOnly: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.compileOnly),
  useSetCompileOnly: () => useOpenPLCStore((state) => state.deviceActions.setCompileOnly),
}

const communicationSelectors = {
  useEnabledRTU: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledRTU,
    ),
  useEnabledTCP: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledTCP,
    ),
  useEnabledDHCP: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.communicationConfiguration.communicationPreferences.enabledDHCP,
    ),
  useDeviceBoard: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard),
  useSetCommunicationPreferences: () => useOpenPLCStore((state) => state.deviceActions.setCommunicationPreferences),
}

// ===================== Remote Device selectors. =====================
const remoteDeviceSelectors = {
  /**
   * Returns all IO points from all remote devices with their device and group context.
   * Used to populate the location dropdown with remote device aliases.
   * Uses shallow comparison to prevent unnecessary re-renders when the data hasn't changed.
   */
  useRemoteDeviceIOPoints: (): RemoteDeviceIOPoint[] =>
    useOpenPLCStore(
      useShallow((state) => {
        const remoteDevices = state.project.data.remoteDevices
        if (!remoteDevices) return []

        const ioPoints: RemoteDeviceIOPoint[] = []

        for (const device of remoteDevices) {
          if (!device.modbusTcpConfig?.ioGroups) continue
          for (const ioGroup of device.modbusTcpConfig.ioGroups) {
            for (const point of ioGroup.ioPoints) {
              ioPoints.push({
                deviceName: device.name,
                ioGroupName: ioGroup.name,
                ioPointId: point.id,
                ioPointName: point.name,
                ioPointType: point.type,
                iecLocation: point.iecLocation,
                alias: point.alias,
              })
            }
          }
        }
        return ioPoints
      }),
    ),
}

// ===================== Search selectors. =====================
const searchSelectors = {
  useSearchQuery: () => useOpenPLCStore((state) => state.searchQuery),
  useSearchResults: () => useOpenPLCStore((state) => state.searchResults),
}

// ===================== Variables table selectors. =====================
const variablesSelectors = {
  useGetVariable: () => useOpenPLCStore((state) => state.projectActions.getVariable),
}

// ===================== Editor selectors. ====================
const editorSelectors = {
  useEditorState: () => useOpenPLCStore((state) => state.editor),
}

// ===================== Pous selectors. =====================
const pouSelectors = {
  usePous: (fileName: string): PLCPou | undefined =>
    useOpenPLCStore((state) => state.project.data.pous.find((pou) => pou.data.name === fileName) as PLCPou),
}

// ===================== Datatype selectors. =====================
const datatypeSelectors = {
  useDatatypes: () => useOpenPLCStore((state) => state.project.data.dataTypes),
}

// ===================== Project selectors. =====================
const projectSelectors = {
  useProjectPath: () => useOpenPLCStore((state) => state.project.meta.path),
}

// ===================== Resource selectors. =====================
const resourceSelectors = {
  useResources: () => useOpenPLCStore((state) => state.project.data.configuration.resource),
}

/**
 * ====================== Workspace selectors. =====================
 */
const workspaceSelectors = {
  useWorkspace: () => useOpenPLCStore((state) => state.workspace),
  useEditingState: () => useOpenPLCStore((state) => state.workspace.editingState),
  useSetEditingState: () => useOpenPLCStore((state) => state.workspaceActions.setEditingState),
  useSelectedProjectTreeLeaf: () => useOpenPLCStore((state) => state.workspace.selectedProjectTreeLeaf),
  useRecent: () => useOpenPLCStore((state) => state.workspace.recent),
  useSetRecent: () => useOpenPLCStore((state) => state.workspaceActions.setRecent),
  useSetModalOpen: () => useOpenPLCStore((state) => state.workspaceActions.setModalOpen),
  useSwitchAppTheme: () => useOpenPLCStore((state) => state.workspaceActions.switchAppTheme),
  useToggleCollapse: () => useOpenPLCStore((state) => state.workspaceActions.toggleCollapse),
}

// ===================== Console selectors. =====================
const consoleSelectors = {
  useLogs: () => useOpenPLCStore((state) => state.logs),
  useAddLog: () => useOpenPLCStore((state) => state.consoleActions.addLog),
  useRemoveLog: () => useOpenPLCStore((state) => state.consoleActions.removeLog),
  useClearLogs: () => useOpenPLCStore((state) => state.consoleActions.clearLogs),
}

// ===================== File selectors =====================
const fileSelectors = {
  useFiles: () => useOpenPLCStore((state) => state.files),
  useGetFile: () => useOpenPLCStore((state) => state.fileActions.getFile),
  useIsFileSaved: () => useOpenPLCStore((state) => state.fileActions.getSavedState),
  useUpdateFile: () => useOpenPLCStore((state) => state.fileActions.updateFile),
}

// ===================== Shared selectors =====================
const sharedSelectors = {
  useHandleFileAndWorkspaceSavedState: () =>
    useOpenPLCStore((state) => state.sharedWorkspaceActions.handleFileAndWorkspaceSavedState),
  useCloseProject: () => useOpenPLCStore((state) => state.sharedWorkspaceActions.closeProject),
  useOpenProject: () => useOpenPLCStore((state) => state.sharedWorkspaceActions.openProject),
  useSaveProject: () => useOpenPLCStore((state) => state.sharedWorkspaceActions.saveProject),
  useSaveFile: () => useOpenPLCStore((state) => state.sharedWorkspaceActions.saveFile),
  useCloseFile: () => useOpenPLCStore((state) => state.sharedWorkspaceActions.closeFile),
  useOpenProjectByPath: () => useOpenPLCStore((state) => state.sharedWorkspaceActions.openProjectByPath),
}

// ===================== Ladder selectors. =====================
const ladderSelectors = {
  useGetIsRungOpen: () => useOpenPLCStore((state) => state.editorActions.getIsRungOpen),
  useUpdateModelLadder: () => useOpenPLCStore((state) => state.editorActions.updateModelLadder),
}

// ===================== Modal selectors. =====================
const modalSelectors = {
  useOpenModal: () => useOpenPLCStore((state) => state.modalActions.openModal),
}

// ===================== Snapshot selectors. =====================
const snapshotSelectors = {
  useUndo: () => useOpenPLCStore((state) => state.snapshotActions.undo),
  useRedo: () => useOpenPLCStore((state) => state.snapshotActions.redo),
}

// ===================== System config selectors. =====================
const systemConfigSelectors = {
  useOS: () => useOpenPLCStore((state) => state.workspace.systemConfigs.OS),
  useShouldUseDarkMode: () => useOpenPLCStore((state) => state.workspace.systemConfigs.shouldUseDarkMode),
}

// ===================== Title bar selectors. =====================
const titleBarSelectors = {
  useOS: () => useOpenPLCStore((state) => state.workspace.systemConfigs.OS),
  useProjectPath: () => useOpenPLCStore((state) => state.project.meta.path),
}

// ===================== Menu selectors. =====================
const menuSelectors = {
  useProject: () => useOpenPLCStore((state) => state.project),
  useDeviceDefinitions: () => useOpenPLCStore((state) => state.deviceDefinitions),
  useSelectedTab: () => useOpenPLCStore((state) => state.selectedTab),
}

export {
  boardSelectors,
  communicationSelectors,
  compileOnlySelectors,
  consoleSelectors,
  datatypeSelectors,
  deviceSelectors,
  editorSelectors,
  fileSelectors,
  ladderSelectors,
  menuSelectors,
  modalSelectors,
  pinSelectors,
  pouSelectors,
  projectSelectors,
  remoteDeviceSelectors,
  resourceSelectors,
  rtuSelectors,
  searchSelectors,
  sharedSelectors,
  snapshotSelectors,
  staticHostSelectors,
  systemConfigSelectors,
  tcpSelectors,
  titleBarSelectors,
  variablesSelectors,
  workspaceSelectors,
}
