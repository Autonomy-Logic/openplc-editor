import { DeviceConfiguration, DevicePin } from '@root/types/PLC/devices'
import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceSlice } from './types'
import {
  checkIfPinIsValid,
  checkIfPinNameIsValid,
  createNewAddress,
  getHighestPinAddress,
  removeAddressPrefix,
} from './validation/pins'

// Default configuration for deviceDefinitions.configuration
const defaultDeviceConfiguration: DeviceConfiguration = {
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
      // tcpMacAddress: '0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD',
      tcpMacAddress: 'DE:AD:BE:EF:DE:AD',
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
}

const createDeviceSlice: StateCreator<DeviceSlice, [], [], DeviceSlice> = (setState) => ({
  deviceAvailableOptions: {
    availableBoards: new Map(),
    availableCommunicationPorts: [],
    availableRTUInterfaces: ['Serial', 'Serial 1', 'Serial 2', 'Serial 3'],
    availableRTUBaudRates: ['9600', '14400', '19200', '38400', '57600', '115200'],
    availableTCPInterfaces: ['Ethernet', 'Wi-Fi'], // The available TCP interfaces is always ['ethernet', 'wifi'], so we can set it on the slice creation.
  },
  deviceDefinitions: {
    configuration: defaultDeviceConfiguration,
    pinMapping: {
      pins: [],
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
    setDeviceDefinitions: ({ configuration, pinMapping }): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          if (configuration) {
            deviceDefinitions.configuration = mergeDeviceConfigWithDefaults(configuration, defaultDeviceConfiguration)
          }
          if (pinMapping) {
            deviceDefinitions.pinMapping.pins = pinMapping || []
            deviceDefinitions.pinMapping.currentSelectedPinTableRow = -1
          }
        }),
      )
    },
    clearDeviceDefinitions: (): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.configuration = defaultDeviceConfiguration
          deviceDefinitions.pinMapping = {
            pins: [],
            currentSelectedPinTableRow: -1,
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
            name: '',
          }

          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) {
            pinMapping.pins.push(newPin)
            pinMapping.currentSelectedPinTableRow = pinMapping.pins.length - 1
            return
          }

          const newAddress = createNewAddress('INCREMENT', referencePin.address)
          const pinExists = pinMapping.pins.find((pin) => pin.address === newAddress)

          if (!pinExists) {
            newPin = { pin: '', pinType: referencePin.pinType, address: newAddress, name: '' }
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
            name: '',
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

          // Check if the pins array is empty after removing the pin, if so, reset the current selected pin table row
          const selectedRow =
            pinMapping.pins.length - 1 > 0
              ? pinMapping.pins.length - 1 === pinMapping.currentSelectedPinTableRow
                ? Math.max(pinMapping.currentSelectedPinTableRow - 1, 0)
                : pinMapping.currentSelectedPinTableRow
              : -1

          pinMapping.pins.splice(pinMapping.currentSelectedPinTableRow, 1)
          pinMapping.currentSelectedPinTableRow = selectedRow
        }),
      )
    },
    updatePin: (updatedData): { ok: boolean; title: string; message: string } => {
      const returnMessage = {
        ok: true,
        title: '',
        message: '',
        data: {
          pin: '',
          pinType: '',
          address: '',
          name: '',
        },
      }
      setState(
        produce(({ deviceDefinitions: { pinMapping } }: DeviceSlice) => {
          const currentPin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]

          if (!currentPin) {
            returnMessage.ok = false
            returnMessage.title = 'No Pin Selected'
            returnMessage.message = 'Please select a pin to update.'
            return
          }

          // Validate the entries of updatedData
          for (const key in updatedData) {
            switch (key) {
              case 'pin': {
                const validation = checkIfPinIsValid(pinMapping.pins, updatedData.pin)
                if (!validation.ok) {
                  returnMessage.ok = false
                  returnMessage.title = validation.title
                  returnMessage.message = validation.message
                  return
                }
                currentPin.pin = updatedData.pin || ''
                returnMessage.data.pin = updatedData.pin || ''
                return
              }

              case 'pinType':
                // Ensure updatedData.pinType is provided and different from the current one
                if (updatedData.pinType && updatedData.pinType !== currentPin.pinType) {
                  const oldPinType = currentPin.pinType
                  const oldAddress = currentPin.address // Address before any potential change by 'address' case
                  const oldAddressPosition = Number(removeAddressPrefix(oldAddress))
                  const newPinType = updatedData.pinType

                  const originalIndex = pinMapping.currentSelectedPinTableRow

                  // 1. Create a new array of pins, excluding the current one for now.
                  // Adjust addresses for pins in the old type group that were after the current pin.
                  const newPinsArray = pinMapping.pins
                    .filter((_, index) => index !== originalIndex) // Exclude current pin
                    .map((p) => {
                      if (p.pinType === oldPinType && Number(removeAddressPrefix(p.address)) > oldAddressPosition) {
                        // Return a new object if 'p' is not a draft or to be safe
                        return { ...p, address: createNewAddress('DECREMENT', p.address) }
                      }
                      return p // 'p' is an Immer draft proxy if it was part of the original array
                    })

                  // 2. Update the currentPin's type (currentPin is an Immer draft object)
                  currentPin.pinType = newPinType

                  // 3. Determine the new address for currentPin in its new type group.
                  // This calculation is based on newPinsArray (which doesn't contain currentPin yet).
                  const highestAddressInNewTypeOfNewArray = getHighestPinAddress(newPinsArray, newPinType)
                  currentPin.address = createNewAddress('INCREMENT', highestAddressInNewTypeOfNewArray)

                  // Ensure this auto-calculated address is used by the final assignment logic.
                  // Also, update validations.address to reflect this automatic change.
                  const finalAddress = currentPin.address // This makes the later generic assignment use this new address.

                  // 4. Add the modified currentPin (which is a draft proxy) back to the new array.
                  newPinsArray.push(currentPin)

                  // 5. Sort the new array of pins.
                  const typeOrder: Array<DevicePin['pinType']> = [
                    'digitalInput',
                    'digitalOutput',
                    'analogInput',
                    'analogOutput',
                  ]
                  newPinsArray.sort((a, b) => {
                    const typeAIndex = typeOrder.indexOf(a.pinType)
                    const typeBIndex = typeOrder.indexOf(b.pinType)
                    if (typeAIndex !== typeBIndex) {
                      return typeAIndex - typeBIndex
                    }
                    return Number(removeAddressPrefix(a.address)) - Number(removeAddressPrefix(b.address))
                  })

                  // 6. Replace the old pins array with the new sorted one in the draft state.
                  pinMapping.pins = newPinsArray

                  // 7. Find the new index of currentPin in the sorted array and update currentSelectedPinTableRow.
                  // currentPin is the draft object, so identity check (p === currentPin) is correct.
                  pinMapping.currentSelectedPinTableRow = pinMapping.pins.findIndex((p) => p === currentPin)

                  returnMessage.data.pinType = newPinType
                  returnMessage.data.address = finalAddress
                  returnMessage.ok = true
                  returnMessage.title = 'Pin Updated'
                  returnMessage.message = `Pin type changed from ${oldPinType} to ${newPinType}. Address updated to ${finalAddress}.`
                  return
                }

                if (updatedData.pinType === currentPin.pinType) {
                  // Pin type is being "updated" to the same value, no structural change needed.
                  returnMessage.data.pinType = currentPin.pinType
                  returnMessage.data.address = currentPin.address // Keep the current address as is
                  returnMessage.ok = true
                  returnMessage.title = 'Pin Type Unchanged'
                  returnMessage.message = `Pin type remains as ${currentPin.pinType}. Address remains as ${currentPin.address}.`
                  return
                }

                // If updatedData.pinType is not provided, this case is skipped,
                // and pinType remains unchanged. validations.pinType retains its default.
                break

              case 'name': {
                const validation = checkIfPinNameIsValid(pinMapping.pins, updatedData.name)
                if (!validation.ok) {
                  returnMessage.ok = false
                  returnMessage.title = validation.title
                  returnMessage.message = validation.message
                  return
                }
                currentPin.name = updatedData.name
                returnMessage.data.name = updatedData.name || ''
                return
              }

              default:
                break
            }
          }
        }),
      )
      return returnMessage
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

function mergeDeviceConfigWithDefaults(
  provided: Partial<DeviceConfiguration>,
  defaults: DeviceConfiguration,
): DeviceConfiguration {
  return {
    ...defaults,
    ...provided,
    deviceBoard: provided.deviceBoard || defaults.deviceBoard,
  }
}

export { createDeviceSlice }
