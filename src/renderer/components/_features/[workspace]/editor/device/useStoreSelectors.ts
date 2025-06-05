import { useOpenPLCStore } from '@root/renderer/store'
import { produce } from 'immer'

type devicePinToTable = {
  pin: string
  pinType?: 'digitalInput' | 'digitalOutput' | 'analogInput' | 'analogOutput'
  address: string
  name?: string
}

export const rtuSelectors = {
  useAvailableRTUInterfaces: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableRTUInterfaces),
  useAvailableRTUBaudRates: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableRTUBaudRates),
  useModbusRTU: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusRTU),
  useSetRTUConfig: () => useOpenPLCStore((state) => state.deviceActions.setRTUConfig),
}

export const tcpSelectors = {
  useAvailableTCPInterfaces: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableTCPInterfaces),
  useModbusTCP: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusTCP),
  useSetTCPConfig: () => useOpenPLCStore((state) => state.deviceActions.setTCPConfig),
  useSetWifiConfig: () => useOpenPLCStore((state) => state.deviceActions.setWifiConfig),
}

export const staticHostSelectors = {
  useTcpStaticHostConfiguration: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration,
    ),
  useSetStaticHostConfiguration: () => useOpenPLCStore((state) => state.deviceActions.setStaticHostConfiguration),
}

export const boardSelectors = {
  useAvailableBoards: () => useOpenPLCStore((state) => state.deviceAvailableOptions.availableBoards),
  useAvailableCommunicationPorts: () =>
    useOpenPLCStore((state) => state.deviceAvailableOptions.availableCommunicationPorts),
  useDeviceBoard: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.deviceBoard),
  useCommunicationPort: () => useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationPort),
  useSetDeviceBoard: () => useOpenPLCStore((state) => state.deviceActions.setDeviceBoard),
  useSetCommunicationPort: () => useOpenPLCStore((state) => state.deviceActions.setCommunicationPort),
  useSetAvailableOptions: () => useOpenPLCStore((state) => state.deviceActions.setAvailableOptions),
  usePinMappingData: () => {
    const pinMappingDataBaseState: devicePinToTable[] = []
    const nextPinMappingDataState: devicePinToTable[] = []
    const pinMappingData = useOpenPLCStore((state) => state.deviceDefinitions.pinMapping.maps)
    for (const key in pinMappingData) {
      produce(pinMappingDataBaseState, (draft) => {
        const currentMap: devicePinToTable[] | undefined = pinMappingData[key as keyof typeof pinMappingData]?.map(
          (pin): devicePinToTable => {
            const newPin: devicePinToTable = { ...pin, pinType: key as keyof typeof pinMappingData }
            return newPin
          },
        )
        if (!currentMap) return draft
        nextPinMappingDataState.push(...currentMap)
      })
    }
    return nextPinMappingDataState
  },
}

export const communicationSelectors = {
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
