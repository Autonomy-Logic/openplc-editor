import { faker } from '@faker-js/faker'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DevicePin, DeviceSlice } from './types'
import { createNewAddress, getHighestPinAddress, removeAddressPrefix } from './validation/pins'

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
      pins: [
        { pin: 'pin0', pinType: 'digitalInput', address: '%IX0.0', name: 'name0' },
        { pin: 'pin1', pinType: 'digitalOutput', address: '%QX0.0', name: 'name1' },
        { pin: 'pin2', pinType: 'analogInput', address: '%IW0', name: 'name2' },
        { pin: 'pin3', pinType: 'analogOutput', address: '%QW0', name: 'name3' },
      ],
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
    // MOCK: We added a library to generate random names for new pins to be more explicit what object we're manipulating, this need to be removed further.
    createNewPin: (): void => {
      setState(
        produce(({ deviceDefinitions: { pinMapping } }: DeviceSlice) => {
          const referencePin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]
          // Find the next available address for default pin type
          const defaultPinType = 'digitalInput'
          const nextHighestPinAddress = getHighestPinAddress(pinMapping.pins, defaultPinType)
          const nextAddress = createNewAddress('INCREMENT', nextHighestPinAddress)

          let newPin: DevicePin = {
            pin: '',
            pinType: defaultPinType,
            address: nextAddress,
            name: faker.food.vegetable(),
          }

          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) {
            pinMapping.pins.push(newPin)
            pinMapping.currentSelectedPinTableRow = pinMapping.pins.length - 1
            return
          }

          const newAddress = createNewAddress('INCREMENT', referencePin.address)
          const pinExists = pinMapping.pins.find((pin) => pin.address === newAddress)

          if (!pinExists) {
            newPin = { pin: '', pinType: referencePin.pinType, address: newAddress, name: faker.food.vegetable() }
            pinMapping.pins.splice(pinMapping.currentSelectedPinTableRow + 1, 0, newPin)
            pinMapping.currentSelectedPinTableRow += 1
            return
          }

          const highestPinAddress = getHighestPinAddress(pinMapping.pins, pinExists.pinType)
          const indexOfHighestPinAddress = pinMapping.pins.findIndex((pin) => pin.address === highestPinAddress)
          const newAddressForHighestPinAddress = createNewAddress('INCREMENT', highestPinAddress)
          const newPinForHighestPinAddress = {
            pin: '',
            pinType: pinExists.pinType,
            address: newAddressForHighestPinAddress,
            name: faker.food.vegetable(),
          }

          pinMapping.pins.splice(indexOfHighestPinAddress + 1, 0, newPinForHighestPinAddress)
          pinMapping.currentSelectedPinTableRow = indexOfHighestPinAddress + 1
        }),
      )
    },
    removePin: (): void => {
      setState(
        produce(({ deviceDefinitions: { pinMapping } }: DeviceSlice) => {
          // Found the reference pin based on the current selected pin table row
          const referencePin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]

          const referencePinType = referencePin.pinType
          const referencePinAddressPosition = Number(removeAddressPrefix(referencePin.address))

          // Early return if there is no selected row in the pin table or pin to reference
          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) return

          pinMapping.pins.forEach((pin) => {
            if (
              pin.pinType === referencePinType &&
              Number(removeAddressPrefix(pin.address)) > referencePinAddressPosition
            ) {
              pin.address = createNewAddress('DECREMENT', pin.address)
            }
          })
          // Verify if this is the last pin with this address type
          // if (isAddressTheLowestInItsType(referencePin.address)) {
          pinMapping.pins.splice(pinMapping.currentSelectedPinTableRow, 1)
          pinMapping.currentSelectedPinTableRow = -1
          // }
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
