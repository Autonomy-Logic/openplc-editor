import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceConfiguration, DevicePin } from '../../../../middleware/shared/ports/types'
import { defaultDeviceConfiguration } from './data/types'
import type { DeviceSlice, DeviceSliceRoot, PinUpdateResponse } from './types'
import {
  checkIfPinAliasIsValid,
  checkIfPinIsValid,
  createNewAddress,
  getHighestPinAddress,
  removeAddressPrefix,
} from './validation/pins'

const createDeviceSlice: StateCreator<DeviceSliceRoot, [], [], DeviceSlice> = (setState, getState) => ({
  deviceAvailableOptions: {
    availableBoards: new Map(),
    availableCommunicationPorts: [],
  },
  deviceDefinitions: {
    configuration: defaultDeviceConfiguration,
    pinMapping: {
      pins: [],
      currentSelectedPinTableRow: -1,
    },
  },
  deviceUpdated: {
    updated: false,
  },
  runtimeConnection: {
    jwtToken: null,
    connectionStatus: 'disconnected',
    plcStatus: null,
    ipAddress: null,
    selectedDevice: null,
    storedCredentials: null,
    timingStats: null,
    includeTimingStatsInPolling: false,
    ethercatStatus: null,
    includeEthercatStatsInPolling: false,
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

      // availableBoards drives target-capability resolution, which the
      // alias registry depends on. This action is the project-load
      // sync point: the workspace screen calls us once it finishes
      // board discovery, so by the time we run, the active target's
      // capabilities resolve correctly. Re-syncing on every subsequent
      // boards refresh (e.g. VPP package install) catches capability
      // shifts for the active board.
      //
      // We only sync when `availableBoards` was actually provided —
      // ports-only updates (e.g. board.tsx refresh-ports) don't affect
      // capabilities and shouldn't churn the alias registry.
      if (availableBoards) {
        const syncReport = getState().projectActions.syncVariableAliases()
        if (syncReport.adopted > 0 || syncReport.refreshed > 0 || syncReport.orphaned > 0) {
          getState().consoleActions.addLog({
            id: crypto.randomUUID(),
            level: 'info',
            message: `Alias sync: adopted=${syncReport.adopted} refreshed=${syncReport.refreshed} orphaned=${syncReport.orphaned}`,
          })
        }
      }
    },
    setDeviceDefinitions: ({ configuration, pinMapping }): void => {
      setState(
        produce(({ deviceDefinitions, runtimeConnection }: DeviceSlice) => {
          if (configuration) {
            deviceDefinitions.configuration = mergeDeviceConfigWithDefaults(configuration, defaultDeviceConfiguration)
            if (deviceDefinitions.configuration.runtimeIpAddress) {
              runtimeConnection.ipAddress = deviceDefinitions.configuration.runtimeIpAddress
            }
          }
          if (pinMapping) {
            deviceDefinitions.pinMapping.pins = pinMapping
            deviceDefinitions.pinMapping.currentSelectedPinTableRow = -1
          }
        }),
      )
    },
    clearDeviceDefinitions: (): void => {
      setState(
        produce(({ deviceDefinitions, runtimeConnection }: DeviceSlice) => {
          deviceDefinitions.configuration = defaultDeviceConfiguration
          deviceDefinitions.pinMapping = {
            pins: [],
            currentSelectedPinTableRow: -1,
          }
          runtimeConnection.jwtToken = null
          runtimeConnection.connectionStatus = 'disconnected'
          runtimeConnection.plcStatus = null
          runtimeConnection.ipAddress = null
          runtimeConnection.selectedDevice = null
          runtimeConnection.storedCredentials = null
          runtimeConnection.timingStats = null
          runtimeConnection.includeTimingStatsInPolling = false
          runtimeConnection.ethercatStatus = null
          runtimeConnection.includeEthercatStatsInPolling = false
        }),
      )
    },
    resetDeviceUpdated: (): void => {
      setState(
        produce(({ deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = false
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

    createNewPin: (): void => {
      setState(
        produce(({ deviceDefinitions: { pinMapping }, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true

          const referencePin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]
          const defaultPinType = 'digitalInput'
          const nextHighestPinAddress = getHighestPinAddress(pinMapping.pins, defaultPinType)
          const nextAddress = createNewAddress('INCREMENT', nextHighestPinAddress)

          let newPin: DevicePin = {
            pin: '',
            pinType: defaultPinType,
            address: nextAddress,
            alias: '',
          }

          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) {
            pinMapping.pins.push(newPin)
            pinMapping.currentSelectedPinTableRow = pinMapping.pins.length - 1
            return
          }

          const newAddress = createNewAddress('INCREMENT', referencePin.address)
          const pinExists = pinMapping.pins.find((pin) => pin.address === newAddress)

          if (!pinExists) {
            newPin = { pin: '', pinType: referencePin.pinType, address: newAddress, alias: '' }
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
            alias: '',
          }

          pinMapping.pins.splice(indexOfHighestPinAddress + 1, 0, newPinForHighestPinAddress)
          pinMapping.currentSelectedPinTableRow = indexOfHighestPinAddress + 1
        }),
      )
    },
    removePin: (): void => {
      setState(
        produce(({ deviceDefinitions: { pinMapping }, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true

          const referencePin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]
          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) return

          const referencePinType = referencePin.pinType
          const referencePinAddressPosition = Number(removeAddressPrefix(referencePin.address))

          pinMapping.pins.forEach((pin) => {
            if (
              pin.pinType === referencePinType &&
              Number(removeAddressPrefix(pin.address)) > referencePinAddressPosition
            ) {
              pin.address = createNewAddress('DECREMENT', pin.address)
            }
          })

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
    updatePin: (updatedData): PinUpdateResponse => {
      const returnMessage: PinUpdateResponse = {
        ok: true,
        title: '',
        message: '',
        data: { pin: '', pinType: '', address: '', alias: '' },
      }
      setState(
        produce(({ deviceDefinitions: { pinMapping }, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true

          const currentPin = pinMapping.pins[pinMapping.currentSelectedPinTableRow]

          if (!currentPin) {
            returnMessage.ok = false
            returnMessage.title = 'No Pin Selected'
            returnMessage.message = 'Please select a pin to update.'
            return
          }

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
                returnMessage.data!.pin = updatedData.pin || ''
                return
              }

              case 'pinType':
                if (updatedData.pinType && updatedData.pinType !== currentPin.pinType) {
                  const oldPinType = currentPin.pinType
                  const oldAddress = currentPin.address
                  const oldAddressPosition = Number(removeAddressPrefix(oldAddress))
                  const newPinType = updatedData.pinType

                  const originalIndex = pinMapping.currentSelectedPinTableRow

                  const newPinsArray = pinMapping.pins
                    .filter((_, index) => index !== originalIndex)
                    .map((p) => {
                      if (p.pinType === oldPinType && Number(removeAddressPrefix(p.address)) > oldAddressPosition) {
                        return { ...p, address: createNewAddress('DECREMENT', p.address) }
                      }
                      return p
                    })

                  currentPin.pinType = newPinType

                  const highestAddressInNewTypeOfNewArray = getHighestPinAddress(newPinsArray, newPinType)
                  currentPin.address = createNewAddress('INCREMENT', highestAddressInNewTypeOfNewArray)

                  const finalAddress = currentPin.address

                  newPinsArray.push(currentPin)

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

                  pinMapping.pins = newPinsArray

                  pinMapping.currentSelectedPinTableRow = pinMapping.pins.findIndex((p) => p === currentPin)

                  returnMessage.data!.pinType = newPinType
                  returnMessage.data!.address = finalAddress
                  returnMessage.ok = true
                  returnMessage.title = 'Pin Updated'
                  returnMessage.message = `Pin type changed from ${oldPinType} to ${newPinType}. Address updated to ${finalAddress}.`
                  return
                }

                if (updatedData.pinType === currentPin.pinType) {
                  returnMessage.data!.pinType = currentPin.pinType
                  returnMessage.data!.address = currentPin.address
                  returnMessage.ok = true
                  returnMessage.title = 'Pin Type Unchanged'
                  returnMessage.message = `Pin type remains as ${currentPin.pinType}. Address remains as ${currentPin.address}.`
                  return
                }

                break

              case 'alias': {
                const validation = checkIfPinAliasIsValid(pinMapping.pins, updatedData.alias)
                if (!validation.ok) {
                  returnMessage.ok = false
                  returnMessage.title = validation.title
                  returnMessage.message = validation.message
                  return
                }
                currentPin.alias = updatedData.alias
                returnMessage.data!.alias = updatedData.alias || ''
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
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          // Wipe platformOption selections when the board changes — they're
          // declared per-board in the VPP manifest, so a `cpu=atmega328old`
          // choice from a previous Nano session shouldn't bleed into a fresh
          // Mega/Opta/etc. setup. Compile-time code falls back to each
          // manifest's `default` when the record is empty.
          if (deviceDefinitions.configuration.deviceBoard !== deviceBoard) {
            deviceDefinitions.configuration.selectedPlatformOptions = {}
          }
          deviceDefinitions.configuration.deviceBoard = deviceBoard
        }),
      )
    },
    setSelectedPlatformOption: (key, value): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          if (!deviceDefinitions.configuration.selectedPlatformOptions) {
            deviceDefinitions.configuration.selectedPlatformOptions = {}
          }
          deviceDefinitions.configuration.selectedPlatformOptions[key] = value
        }),
      )
    },
    clearSelectedPlatformOptions: (): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          deviceDefinitions.configuration.selectedPlatformOptions = {}
        }),
      )
    },
    setCommunicationPort: (communicationPort): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          deviceDefinitions.configuration.communicationPort = communicationPort
        }),
      )
    },
    setCompileOnly: (compileOnly): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          deviceDefinitions.configuration.compileOnly = compileOnly
        }),
      )
    },
    setRuntimeIpAddress: (ipAddress): void => {
      setState(
        produce(({ deviceDefinitions, runtimeConnection }: DeviceSlice) => {
          deviceDefinitions.configuration.runtimeIpAddress = ipAddress
          runtimeConnection.ipAddress = ipAddress
        }),
      )
    },
    setRuntimeJwtToken: (token): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.jwtToken = token
        }),
      )
    },
    setRuntimeConnectionStatus: (status): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.connectionStatus = status
        }),
      )
    },
    setPlcRuntimeStatus: (status): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.plcStatus = status
        }),
      )
    },
    setSelectedDevice: (device): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.selectedDevice = device
        }),
      )
    },
    setStoredCredentials: (credentials): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.storedCredentials = credentials
        }),
      )
    },
    setTimingStats: (stats): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.timingStats = stats
        }),
      )
    },
    setIncludeTimingStatsInPolling: (include): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.includeTimingStatsInPolling = include
        }),
      )
    },
    setEthercatStatus: (status): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.ethercatStatus = status
        }),
      )
    },
    setIncludeEthercatStatsInPolling: (include): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.includeEthercatStatsInPolling = include
        }),
      )
    },
    setTemporaryDhcpIp: (ipAddress): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          deviceDefinitions.temporaryDhcpIp = ipAddress
        }),
      )
    },
    clearRuntimeConnection: (): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.jwtToken = null
          runtimeConnection.connectionStatus = 'disconnected'
          runtimeConnection.plcStatus = null
          runtimeConnection.ipAddress = null
          runtimeConnection.selectedDevice = null
          runtimeConnection.storedCredentials = null
          runtimeConnection.timingStats = null
          runtimeConnection.includeTimingStatsInPolling = false
          runtimeConnection.ethercatStatus = null
          runtimeConnection.includeEthercatStatsInPolling = false
        }),
      )
    },
    setVendorScreenData: (persistenceKey, data): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          if (!deviceDefinitions.configuration.vendorScreenData) {
            deviceDefinitions.configuration.vendorScreenData = {}
          }
          deviceDefinitions.configuration.vendorScreenData[persistenceKey] = data
        }),
      )
    },
    /**
     * Restore a contiguous slice of `vendorScreenData` from a snapshot.
     * Used by the vendor-screen tab's "Don't save" revert path: the
     * snapshot was captured when the tab opened (or on last save),
     * and applying it back means deleting any keys the user added in
     * this session and putting the rest back to their original
     * values.  Keys outside `ownedKeys` are left untouched so other
     * vendor-screen tabs and the device editor don't see unrelated
     * mutations.
     */
    restoreVendorScreenSlice: (ownedKeys, snapshot): void => {
      setState(
        produce(({ deviceDefinitions }: DeviceSlice) => {
          if (!deviceDefinitions.configuration.vendorScreenData) {
            deviceDefinitions.configuration.vendorScreenData = {}
          }
          const target = deviceDefinitions.configuration.vendorScreenData
          for (const key of ownedKeys) {
            if (Object.prototype.hasOwnProperty.call(snapshot, key)) {
              target[key] = snapshot[key]
            } else {
              delete target[key]
            }
          }
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
    deviceBoard: provided.deviceBoard || defaults.deviceBoard,
    communicationPort: provided.communicationPort ?? defaults.communicationPort,
    runtimeIpAddress: provided.runtimeIpAddress ?? defaults.runtimeIpAddress,
    compileOnly: provided.compileOnly ?? defaults.compileOnly,
    vendorScreenData: provided.vendorScreenData ?? defaults.vendorScreenData,
    // Must merge — otherwise loading a project whose configuration.json
    // predates platformOptions leaves the field undefined in the store, and
    // every selector falling back to `?? {}` returns a fresh literal that
    // triggers an infinite Zustand re-render loop (blank device screen).
    selectedPlatformOptions: provided.selectedPlatformOptions ?? defaults.selectedPlatformOptions,
  }
}

export { createDeviceSlice }
