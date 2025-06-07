import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DevicePin, DeviceSlice } from './types'
import { createNewAddress, getHighestPinAddress } from './validation/pins'
// import { extractPositionForAnalogAddress, extractPositionsForDigitalAddress } from './validation/pins'

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
    /** The default action to add a pin is handled by the editor itself, so we don't need to check for if the pin is already declared */
    createNewPin: (): void => {
      setState(
        produce(({ deviceDefinitions: { pinMapping } }: DeviceSlice) => {
          const basePin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]
          let newPin: DevicePin = {
            pin: 'pin0',
            pinType: 'digitalInput',
            address: '%IX0.0',
            name: '',
          }

          if (pinMapping.currentSelectedPinTableRow === -1 || !basePin) {
            pinMapping.pins.push(newPin)
            pinMapping.currentSelectedPinTableRow = pinMapping.pins.length - 1
            return
          }

          const newAddress = createNewAddress('INCREMENT', basePin.address)
          const pinExists = (JSON.parse(JSON.stringify([...pinMapping.pins])) as DevicePin[]).find(
            (pin) => pin.address === newAddress,
          )

          if (!pinExists) {
            newPin = { pin: '', pinType: basePin.pinType, address: newAddress }
            pinMapping.pins.splice(pinMapping.currentSelectedPinTableRow + 1, 0, newPin)
            pinMapping.currentSelectedPinTableRow += 1
            return
          }

          // TODO: We need to verify which is the pin of this type with the highest value to continue the sequence
          // We can do it in possibly two ways.
          // Creating and ordering a temporary array with a copy of every value in the state that satisfies the address prefix
          // or executing a compare function on every entry in the main array.
          const highestPinAddress = getHighestPinAddress(pinMapping.pins, pinExists.pinType)
          const indexOfHighestPinAddress = pinMapping.pins.findIndex((pin) => pin.address === highestPinAddress)
          const newAddressForHighestPinAddress = createNewAddress('INCREMENT', highestPinAddress)
          const newPinForHighestPinAddress = {
            pin: '',
            pinType: pinExists.pinType,
            address: newAddressForHighestPinAddress,
          }

          pinMapping.pins.splice(indexOfHighestPinAddress + 1, 0, newPinForHighestPinAddress)
          pinMapping.currentSelectedPinTableRow = indexOfHighestPinAddress + 1
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
