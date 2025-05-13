import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  deviceAvailableOptions: {
    availableBoards: new Map(),
    availableCommunicationPorts: [],
    availableRTUInterfaces: ['Serial', 'Serial 1', 'Serial 2', 'Serial 3'],
    availableRTUBaudRates: ['9600', '14400', '19200', '38400', '57600', '115200'],
    availableTCPInterfaces: ['ethernet', 'wifi'], // The available TCP interfaces is always ['ethernet', 'wifi'], so we can set it on the slice creation.
  },
  deviceDefinitions: {
    configuration: {
      deviceBoard: 'OpenPLC Runtime',
      communicationPort: '',
      communicationConfiguration: {
        modbusRTU: {
          rtuInterface: 'Serial',
          rtuBaudRate: '115200',
          rtuSlaveId: '',
          rtuRS485ENPin: '',
        },
        modbusTCP: {
          tcpInterface: 'ethernet',
          tcpMacAddress: '',
          tcpWifiSSID: '',
          tcpWifiPassword: '',
          tcpStaticHostConfiguration: {
            ipAddress: '',
            dns: '',
            gateway: '',
            subnet: '',
          },
        },
      },
    },
    pinMapping: [],
  },

  deviceActions: {
    setAvailableOptions: ({ availableBoards, availableCommunicationPorts }): void => {
      setState(
        produce(({ deviceAvailableOptions }: DeviceSlice) => {
          if (availableBoards) {
            deviceAvailableOptions.availableBoards = availableBoards
          }
          if (availableCommunicationPorts) {
            deviceAvailableOptions.availableCommunicationPorts = availableCommunicationPorts
          }
        }),
      )
    },
    addPin: (pinProp): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          console.log('Pin parameter:', pinProp)
          console.log('Device state:', deviceDefinitions)
        }),
      )
    },
    setDeviceBoard: (deviceBoard): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.configuration.deviceBoard = deviceBoard
        }),
      )
    },
    setCommunicationPort: (communicationPort): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.configuration.communicationPort = communicationPort
        }),
      )
    },
    setRTUConfig: (rtuConfigOption): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          const { rtuConfig, value } = rtuConfigOption
          switch (rtuConfig) {
            case 'rtuBaudRate':
              deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuBaudRate = value
              break
            case 'rtuInterface':
              deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuInterface = value
              break
            case 'rtuSlaveId':
              deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuSlaveId = value
              break
            case 'rtuRS485ENPin':
              deviceDefinitions.configuration.communicationConfiguration.modbusRTU.rtuRS485ENPin = value
              break
            default:
              break
          }
        }),
      )
    },
    setTCPConfig: (tcpConfigOption): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          const { tcpConfig, value } = tcpConfigOption
          switch (tcpConfig) {
            case 'tcpInterface':
              deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpInterface = value
              break
            case 'tcpMacAddress':
              deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpMacAddress = value
              break
            default:
              break
          }
        }),
      )
    },
    setWifConfig: (wifiConfig): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          if (deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpInterface === 'wifi') {
            if (wifiConfig.wifiSSID)
              deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiSSID = wifiConfig.wifiSSID
            if (wifiConfig.wifiPassword)
              deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiPassword =
                wifiConfig.wifiPassword
          }
        }),
      )
    },
    setStaticHostConfiguration: (staticHostConfiguration): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          if (staticHostConfiguration.ipAddress)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.ipAddress =
              staticHostConfiguration.ipAddress
          if (staticHostConfiguration.dns)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.dns =
              staticHostConfiguration.dns
          if (staticHostConfiguration.gateway)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.gateway =
              staticHostConfiguration.gateway
          if (staticHostConfiguration.subnet)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.subnet =
              staticHostConfiguration.subnet
        }),
      )
    },
  },
})

export { createDeviceSlice }
