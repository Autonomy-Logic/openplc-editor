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
// Stable reference for the empty-platform-options fallback. Returning a
// fresh `{}` from the selector on every call would defeat Zustand's
// reference-equality check and trigger an infinite re-render loop in any
// component subscribed to it (manifests as a blank device-configuration
// screen). The slice's merge function is the primary defence (it always
// populates the field on load), but this fallback covers async edge cases
// where the field could transiently be undefined.
const EMPTY_SELECTED_PLATFORM_OPTIONS: Record<string, string> = Object.freeze({}) as Record<string, string>

const boardSelectors = {
  useAvailableBoards: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableBoards),
  useAvailableCommunicationPorts: () =>
    useOpenPLCStore((state) => state.deviceAvailableOptions.availableCommunicationPorts),
  useDeviceBoard: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard),
  useCommunicationPort: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationPort),
  useSelectedPlatformOptions: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.selectedPlatformOptions ?? EMPTY_SELECTED_PLATFORM_OPTIONS,
    ),
  useSetDeviceBoard: () => useOpenPLCStore((state) => state.deviceActions.setDeviceBoard),
  useSetCommunicationPort: () => useOpenPLCStore((state) => state.deviceActions.setCommunicationPort),
  useSetSelectedPlatformOption: () => useOpenPLCStore((state) => state.deviceActions.setSelectedPlatformOption),
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
  compileOnlySelectors,
  ladderSelectors,
  pinSelectors,
  remoteDeviceSelectors,
  vendorIoSelectors,
}

export type { RemoteDeviceIOPoint }
