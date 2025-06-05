import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'
import { extractPositionForAnalogAddress, extractPositionsForDigitalAddress } from './validation/pins'

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  deviceAvailableOptions: {
    availableBoards: new Map(),
    availableCommunicationPorts: [],
    availableRTUInterfaces: ['Serial', 'Serial 1', 'Serial 2', 'Serial 3'],
    availableRTUBaudRates: ['9600', '14400', '19200', '38400', '57600', '115200'],
    availableTCPInterfaces: ['Ethernet', 'Wi-Fi'], // The available TCP interfaces is always ['ethernet', 'wifi'], so we can set it on the slice creation.
  },
  deviceDefinitions: {
    configuration: {
      deviceBoard: 'OpenPLC Runtime',
      communicationPort: '',
      communicationConfiguration: {
        modbusRTU: {
          rtuInterface: 'Serial',
          rtuBaudRate: '115200',
          rtuSlaveId: null,
          rtuRS485ENPin: null,
        },
        modbusTCP: {
          tcpInterface: 'Ethernet',
          tcpMacAddress: '0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD',
          tcpWifiSSID: null,
          tcpWifiPassword: null,
          tcpStaticHostConfiguration: {
            ipAddress: '',
            dns: '',
            gateway: '',
            subnet: '',
          },
        },
        communicationPreferences: {
          enabledRTU: false,
          enabledTCP: false,
          enabledDHCP: true,
        },
      },
    },
    pinMapping: {
      maps: {
        digitalInput: [{ pin: 'pin0', address: '%IX0.0', name: 'name0' }],
        digitalOutput: [{ pin: 'pin1', address: '%QX0.0', name: 'name1' }],
        analogInput: [{ pin: 'pin2', address: '%IW0', name: 'name2' }],
        analogOutput: [{ pin: 'pin3', address: '%QW0', name: 'name3' }],
      },
      currentSelectedPinTableRow: -1,
    },
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
    selectPinTableRow: (selectedRow) => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.pinMapping.currentSelectedPinTableRow = selectedRow
        }),
      )
    },
    /** The default action to add a pin is handled by the editor itself, so we don't need to check for if the pin is already declared */
    addPin: ({ pinType = 'digitalInput', pinToAdd }): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          const newPin = {
            pin: pinToAdd.name ?? '',
            address: '',
            name: pinToAdd.name ?? '',
          }
          // This should never return a falsy value, once all maps are initialized.
          const filteredPinMapping = deviceDefinitions.pinMapping.maps[pinType]
          if (!filteredPinMapping) return
          const lastAddedPin = filteredPinMapping[filteredPinMapping.length - 1]
          // Verify the validation type that should be applied
          switch (pinType) {
            case 'digitalInput': {
              if (lastAddedPin === undefined) {
                filteredPinMapping.push({ ...newPin, address: '%IX0.0' })
                break
              }
              const { position, dotPosition } = extractPositionsForDigitalAddress(lastAddedPin.address)
              if (dotPosition === 7) {
                filteredPinMapping.push({ ...newPin, address: `%IX${position + 1}.0` })
              } else {
                filteredPinMapping.push({ ...newPin, address: `%IX${position}.${dotPosition + 1}` })
              }
              break
            }
            case 'digitalOutput': {
              if (lastAddedPin === undefined) {
                filteredPinMapping.push({ ...newPin, address: '%QX0.0' })
                break
              }
              const { position, dotPosition } = extractPositionsForDigitalAddress(lastAddedPin.address)
              if (dotPosition === 7) {
                filteredPinMapping.push({ ...newPin, address: `%QX${position + 1}.0` })
              } else {
                filteredPinMapping.push({ ...newPin, address: `%QX${position}.${dotPosition + 1}` })
              }
              break
            }
            case 'analogInput': {
              if (lastAddedPin === undefined) {
                filteredPinMapping.push({ ...newPin, address: '%IW0' })
                break
              }
              const position = extractPositionForAnalogAddress(lastAddedPin.address)
              filteredPinMapping.push({ ...newPin, address: `%IW${position + 1}` })
              break
            }
            case 'analogOutput': {
              if (lastAddedPin === undefined) {
                filteredPinMapping.push({ ...newPin, address: '%QW0' })
                break
              }
              const position = extractPositionForAnalogAddress(lastAddedPin.address)
              filteredPinMapping.push({ ...newPin, address: `%QW${position + 1}` })
              break
            }
            default:
              console.log('Unsupported pin type')
              break
          }
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
    setCommunicationPreferences: (preferences) => {
      setState(
        produce(({ deviceDefinitions: { configuration } }: DeviceSlice) => {
          if (preferences.enableRTU !== undefined) {
            configuration.communicationConfiguration.communicationPreferences.enabledRTU = preferences.enableRTU
          }
          if (preferences.enableTCP !== undefined) {
            configuration.communicationConfiguration.communicationPreferences.enabledTCP = preferences.enableTCP
          }
          if (preferences.enableDHCP !== undefined) {
            configuration.communicationConfiguration.communicationPreferences.enabledDHCP = preferences.enableDHCP
          }
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
    setWifiConfig: (wifiConfig): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          if (deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpInterface === 'Wi-Fi') {
            if (wifiConfig.tcpWifiSSID)
              deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiSSID = wifiConfig.tcpWifiSSID
            if (wifiConfig.tcpWifiPassword)
              deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpWifiPassword =
                wifiConfig.tcpWifiPassword
          }
        }),
      )
    },
    setStaticHostConfiguration: (staticHostConfiguration): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          if (staticHostConfiguration.ipAddress !== undefined)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.ipAddress =
              staticHostConfiguration.ipAddress
          if (staticHostConfiguration.dns !== undefined)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.dns =
              staticHostConfiguration.dns
          if (staticHostConfiguration.gateway !== undefined)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.gateway =
              staticHostConfiguration.gateway
          if (staticHostConfiguration.subnet !== undefined)
            deviceDefinitions.configuration.communicationConfiguration.modbusTCP.tcpStaticHostConfiguration.subnet =
              staticHostConfiguration.subnet
        }),
      )
    },
  },
})

export { createDeviceSlice }
