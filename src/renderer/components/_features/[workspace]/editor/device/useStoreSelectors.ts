import { useOpenPLCStore } from '@root/renderer/store'
import { shallow } from 'zustand/shallow'

export const rtuSelectors = {
  useAvailableRTUInterfaces: () =>
    useOpenPLCStore((state) => state.deviceAvailableOptions.availableRTUInterfaces, shallow),
  useAvailableRTUBaudRates: () =>
    useOpenPLCStore((state) => state.deviceAvailableOptions.availableRTUBaudRates, shallow),
  useModbusRTU: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusRTU, shallow),
  useSetRTUConfig: () => useOpenPLCStore((state) => state.deviceActions.setRTUConfig, shallow),
}

export const tcpSelectors = {
  useAvailableTCPInterfaces: () =>
    useOpenPLCStore((state) => state.deviceAvailableOptions.availableTCPInterfaces, shallow),
  useModbusTCP: () =>
    useOpenPLCStore((state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusTCP, shallow),
  useSetTCPConfig: () => useOpenPLCStore((state) => state.deviceActions.setTCPConfig, shallow),
  useSetWifiConfig: () => useOpenPLCStore((state) => state.deviceActions.setWifiConfig, shallow),
}

export const staticHostSelectors = {
  useTcpStaticHostConfiguration: () =>
    useOpenPLCStore(
      (state) => state.deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration,
      shallow,
    ),
  useSetStaticHostConfiguration: () =>
    useOpenPLCStore((state) => state.deviceActions.setStaticHostConfiguration, shallow),
}
