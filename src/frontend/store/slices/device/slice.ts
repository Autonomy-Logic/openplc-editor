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

/**
 * Lazily resolve the active board's pin array on an Immer draft,
 * creating the entry the first time a board claims pins. Returns a
 * reference that's safe to mutate (push / splice / index-assign) —
 * the surrounding `produce()` call captures the changes.
 *
 * Centralising this keeps every action's "operate on the current
 * board's pins" intent obvious and prevents a stale write when the
 * dict didn't yet have a key for the active board (which would
 * otherwise crash with `Cannot read properties of undefined`).
 */
function getActivePinsDraft(draft: DeviceSlice): DevicePin[] {
  const board = draft.deviceDefinitions.configuration.deviceBoard
  if (!draft.deviceDefinitions.pinMapping.pinsByBoard[board]) {
    draft.deviceDefinitions.pinMapping.pinsByBoard[board] = []
  }
  return draft.deviceDefinitions.pinMapping.pinsByBoard[board]
}

const createDeviceSlice: StateCreator<DeviceSliceRoot, [], [], DeviceSlice> = (setState, getState) => ({
  deviceAvailableOptions: {
    availableBoards: new Map(),
    availableCommunicationPorts: [],
  },
  deviceDefinitions: {
    configuration: defaultDeviceConfiguration,
    pinMapping: {
      pinsByBoard: {},
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

      // Board discovery only affects target-capability resolution; it no
      // longer needs to touch program variables. In the single-field model a
      // variable's `location` holds either a stable alias name (resolved to an
      // address at compile time) or a literal address — neither changes when
      // the board list lands. Producer address recompaction on an actual
      // target change is handled by `setDeviceBoard → recalculateIecAddresses`.
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
            // Two shapes are accepted by design — see DeviceActions.setDeviceDefinitions.
            // Legacy flat array attaches to whatever board the
            // accompanying configuration names (or the current
            // store value if no configuration was passed). This
            // is the migration path for projects saved before
            // per-board scoping landed.
            if (Array.isArray(pinMapping)) {
              const targetBoard = deviceDefinitions.configuration.deviceBoard
              deviceDefinitions.pinMapping.pinsByBoard = targetBoard ? { [targetBoard]: pinMapping } : {}
            } else {
              deviceDefinitions.pinMapping.pinsByBoard = { ...pinMapping }
            }
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
            pinsByBoard: {},
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
        produce((draft: DeviceSlice) => {
          draft.deviceUpdated.updated = true
          const pins = getActivePinsDraft(draft)
          const { pinMapping } = draft.deviceDefinitions

          const referencePin = pins[pinMapping.currentSelectedPinTableRow]
          const defaultPinType = 'digitalInput'
          const nextHighestPinAddress = getHighestPinAddress(pins, defaultPinType)
          const nextAddress = createNewAddress('INCREMENT', nextHighestPinAddress)

          let newPin: DevicePin = {
            pin: '',
            pinType: defaultPinType,
            address: nextAddress,
            alias: '',
          }

          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) {
            pins.push(newPin)
            pinMapping.currentSelectedPinTableRow = pins.length - 1
            return
          }

          const newAddress = createNewAddress('INCREMENT', referencePin.address)
          const pinExists = pins.find((pin) => pin.address === newAddress)

          if (!pinExists) {
            newPin = { pin: '', pinType: referencePin.pinType, address: newAddress, alias: '' }
            pins.splice(pinMapping.currentSelectedPinTableRow + 1, 0, newPin)
            pinMapping.currentSelectedPinTableRow += 1
            return
          }

          const highestPinAddress = getHighestPinAddress(pins, pinExists.pinType)
          const indexOfHighestPinAddress = pins.findIndex((pin) => pin.address === highestPinAddress)
          const newAddressForHighestPinAddress = createNewAddress('INCREMENT', highestPinAddress)
          const newPinForHighestPinAddress = {
            pin: '',
            pinType: pinExists.pinType,
            address: newAddressForHighestPinAddress,
            alias: '',
          }

          pins.splice(indexOfHighestPinAddress + 1, 0, newPinForHighestPinAddress)
          pinMapping.currentSelectedPinTableRow = indexOfHighestPinAddress + 1
        }),
      )
    },
    removePin: (): void => {
      setState(
        produce((draft: DeviceSlice) => {
          draft.deviceUpdated.updated = true
          const pins = getActivePinsDraft(draft)
          const { pinMapping } = draft.deviceDefinitions

          const referencePin = pins[pinMapping.currentSelectedPinTableRow]
          if (pinMapping.currentSelectedPinTableRow === -1 || !referencePin) return

          const referencePinType = referencePin.pinType
          const referencePinAddressPosition = Number(removeAddressPrefix(referencePin.address))

          pins.forEach((pin) => {
            if (
              pin.pinType === referencePinType &&
              Number(removeAddressPrefix(pin.address)) > referencePinAddressPosition
            ) {
              pin.address = createNewAddress('DECREMENT', pin.address)
            }
          })

          const selectedRow =
            pins.length - 1 > 0
              ? pins.length - 1 === pinMapping.currentSelectedPinTableRow
                ? Math.max(pinMapping.currentSelectedPinTableRow - 1, 0)
                : pinMapping.currentSelectedPinTableRow
              : -1

          pins.splice(pinMapping.currentSelectedPinTableRow, 1)
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
        produce((draft: DeviceSlice) => {
          draft.deviceUpdated.updated = true
          const pins = getActivePinsDraft(draft)
          const { pinMapping } = draft.deviceDefinitions
          const activeBoard = draft.deviceDefinitions.configuration.deviceBoard

          const currentPin = pins[pinMapping.currentSelectedPinTableRow]

          if (!currentPin) {
            returnMessage.ok = false
            returnMessage.title = 'No Pin Selected'
            returnMessage.message = 'Please select a pin to update.'
            return
          }

          for (const key in updatedData) {
            switch (key) {
              case 'pin': {
                const validation = checkIfPinIsValid(pins, updatedData.pin)
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

                  const newPinsArray = pins
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

                  // Replace the active board's bucket with the
                  // re-sorted array. Re-resolve currentPin's index
                  // by identity — the sort moved it.
                  pinMapping.pinsByBoard[activeBoard] = newPinsArray
                  pinMapping.currentSelectedPinTableRow = newPinsArray.findIndex((p) => p === currentPin)

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
                const validation = checkIfPinAliasIsValid(pins, updatedData.alias)
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
      const previousBoard = getState().deviceDefinitions.configuration.deviceBoard
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          // Wipe platformOption selections when the board changes — they're
          // declared per-board in the VPP manifest, so a `cpu=atmega328old`
          // choice from a previous Nano session shouldn't bleed into a fresh
          // Mega/Opta/etc. setup. Compile-time code falls back to each
          // manifest's `default` when the record is empty.
          //
          // Pin mappings on the other hand stay on disk per-board (the
          // `pinsByBoard` dict), so switching here just changes which
          // bucket the active selector pulls from — the previous board's
          // pins are preserved for when the user switches back. The
          // selected-row pointer is reset because the new board's
          // bucket has its own row count.
          if (deviceDefinitions.configuration.deviceBoard !== deviceBoard) {
            deviceDefinitions.configuration.selectedPlatformOptions = {}
            deviceDefinitions.pinMapping.currentSelectedPinTableRow = -1
            // Vendor-screen data is board-specific (a backplane configured for
            // one target is meaningless on another). Stash the outgoing board's
            // data into its bucket, then swap the active view to the incoming
            // board's bucket (empty when it was never configured) — the
            // previous board's modules are preserved for when the user returns,
            // and the new board starts clean instead of inheriting stale slots.
            const cfg = deviceDefinitions.configuration
            syncActiveBoardVendorBucket(cfg)
            cfg.vendorScreenData = { ...(cfg.vendorScreenDataByBoard?.[deviceBoard] ?? {}) }
          }
          deviceDefinitions.configuration.deviceBoard = deviceBoard
        }),
      )
      // Switching target changes which producer kinds are active — a board
      // without pin mapping / VPP frees those addresses. Recompute the
      // Modbus addresses project-wide so they reclaim the freed space, and
      // reconcile bound variables. (Skipped when the board is unchanged.)
      if (previousBoard !== deviceBoard) {
        getState().projectActions.recalculateIecAddresses()
      }
    },
    setSelectedPlatformOption: (key, value): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          /* istanbul ignore if -- selectedPlatformOptions is always initialized to {} on
             store creation (defaults + the merge in normalizeConfigurationForLoad), so this
             defensive guard only fires if the store is ever migrated from an older shape */
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
          syncActiveBoardVendorBucket(deviceDefinitions.configuration)
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
          syncActiveBoardVendorBucket(deviceDefinitions.configuration)
        }),
      )
    },
  },
})

/**
 * Keep the active board's bucket in `vendorScreenDataByBoard` in lock-step
 * with the flat `vendorScreenData` view. Called from every vendor-data
 * mutation so the per-board archive is always current for the active board —
 * which in turn lets board-switch and save treat the archive as authoritative
 * without a separate "flush" step.
 */
function syncActiveBoardVendorBucket(configuration: DeviceConfiguration): void {
  if (!configuration.vendorScreenDataByBoard) {
    configuration.vendorScreenDataByBoard = {}
  }
  configuration.vendorScreenDataByBoard[configuration.deviceBoard] = { ...(configuration.vendorScreenData ?? {}) }
}

/**
 * Resolve the vendor-screen data for a freshly-loaded project into the
 * flat-view + per-board-archive pair the store expects.
 *
 * - When a project already carries `vendorScreenDataByBoard`, it wins: the
 *   active view is that board's bucket (falling back to any flat blob), and
 *   the bucket is ensured present so the active view and archive agree.
 * - Legacy projects only have the flat `vendorScreenData`. It's attributed to
 *   the board the project was saved with, so other boards start clean instead
 *   of inheriting it. Mirrors the `pinsByBoard` migration.
 */
function migrateVendorScreenData(
  provided: Partial<DeviceConfiguration>,
  deviceBoard: string,
): Pick<DeviceConfiguration, 'vendorScreenData' | 'vendorScreenDataByBoard'> {
  const flat = provided.vendorScreenData
  const archive = provided.vendorScreenDataByBoard

  if (archive && Object.keys(archive).length > 0) {
    const active = archive[deviceBoard] ?? flat
    return {
      vendorScreenData: active,
      vendorScreenDataByBoard: active !== undefined ? { ...archive, [deviceBoard]: active } : { ...archive },
    }
  }

  if (flat !== undefined) {
    return { vendorScreenData: flat, vendorScreenDataByBoard: { [deviceBoard]: flat } }
  }

  return { vendorScreenData: undefined, vendorScreenDataByBoard: undefined }
}

function mergeDeviceConfigWithDefaults(
  provided: Partial<DeviceConfiguration>,
  defaults: DeviceConfiguration,
): DeviceConfiguration {
  const deviceBoard = provided.deviceBoard || defaults.deviceBoard
  const { vendorScreenData, vendorScreenDataByBoard } = migrateVendorScreenData(provided, deviceBoard)
  return {
    deviceBoard,
    communicationPort: provided.communicationPort ?? defaults.communicationPort,
    runtimeIpAddress: provided.runtimeIpAddress ?? defaults.runtimeIpAddress,
    vendorScreenData,
    vendorScreenDataByBoard,
    // Must merge — otherwise loading a project whose configuration.json
    // predates platformOptions leaves the field undefined in the store, and
    // every selector falling back to `?? {}` returns a fresh literal that
    // triggers an infinite Zustand re-render loop (blank device screen).
    selectedPlatformOptions: provided.selectedPlatformOptions ?? defaults.selectedPlatformOptions,
  }
}

export { createDeviceSlice }
