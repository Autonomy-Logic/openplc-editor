import { useMemo } from 'react'

import type { IoMappingEntry, VendorIoMapping } from '../../middleware/shared/ports/types'
import { useOpenPLCStore } from '../store'

type RemoteDeviceIOPoint = {
  deviceName: string
  ioGroupName: string
  ioPointId: string
  ioPointName: string
  ioPointType: string
  iecLocation: string
  alias: string
}

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

// ===================== Ladder selectors. =====================
const ladderSelectors = {
  useGetIsRungOpen: () => useOpenPLCStore((state) => state.editorActions.getIsRungOpen),
  useUpdateModelLadder: () => useOpenPLCStore((state) => state.editorActions.updateModelLadder),
}

// ===================== Remote Device selectors. =====================
const remoteDeviceSelectors = {
  useRemoteDeviceIOPoints: (): RemoteDeviceIOPoint[] => {
    const remoteDevices = useOpenPLCStore((state) => state.project.data.remoteDevices)

    return useMemo(() => {
      if (!remoteDevices) return []

      const ioPoints: RemoteDeviceIOPoint[] = []

      for (const device of remoteDevices) {
        // Modbus IO points
        if (device.modbusTcpConfig?.ioGroups) {
          for (const ioGroup of device.modbusTcpConfig.ioGroups) {
            for (const point of ioGroup.ioPoints ?? []) {
              ioPoints.push({
                deviceName: device.name,
                ioGroupName: ioGroup.name,
                ioPointId: point.id,
                ioPointName: point.name,
                ioPointType: point.type,
                iecLocation: point.iecLocation,
                alias: point.alias ?? '',
              })
            }
          }
        }
        // EtherCAT channel mappings
        if (device.ethercatConfig?.devices) {
          for (const dev of device.ethercatConfig.devices) {
            for (const mapping of dev.channelMappings) {
              if (!mapping.alias) continue
              ioPoints.push({
                deviceName: device.name,
                ioGroupName: dev.name,
                ioPointId: mapping.channelId,
                ioPointName: mapping.channelId,
                ioPointType: 'ethercat',
                iecLocation: mapping.iecLocation,
                alias: mapping.alias,
              })
            }
          }
        }
      }
      return ioPoints
    }, [remoteDevices])
  },
}

// ===================== Vendor IO selectors. =====================
const vendorIoSelectors = {
  useVendorIoEntries: (): IoMappingEntry[] => {
    const vendorScreenData = useOpenPLCStore((state) => state.deviceDefinitions.configuration.vendorScreenData)

    return useMemo(() => {
      if (!vendorScreenData) return []

      // Look through all vendorScreenData keys for io-mapping entries
      for (const [, value] of Object.entries(vendorScreenData)) {
        const mapping = value as VendorIoMapping | undefined
        if (mapping?.entries && Array.isArray(mapping.entries) && mapping.entries.length > 0) {
          // Check if it looks like an IO mapping (has iecAddress field)
          if ('iecAddress' in mapping.entries[0]) {
            return mapping.entries
          }
        }
      }
      return []
    }, [vendorScreenData])
  },
}

export {
  boardSelectors,
  communicationSelectors,
  compileOnlySelectors,
  ladderSelectors,
  pinSelectors,
  remoteDeviceSelectors,
  rtuSelectors,
  staticHostSelectors,
  tcpSelectors,
  vendorIoSelectors,
}

export type { RemoteDeviceIOPoint }
