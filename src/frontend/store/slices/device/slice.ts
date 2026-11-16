import { produce } from 'immer'
import { StateCreator } from 'zustand'

import type { DeviceConfiguration, DevicePin } from '../../../../middleware/shared/ports/types'
import { DEFAULT_RETAIN_FLUSH_SECONDS } from '../../../../middleware/shared/ports/types'
import {
  SERIAL_SCREEN_STATE_KEY,
  withoutLegacyRs485Pin,
} from '../../../../middleware/shared/utils/modbus-master-profile'
import { DEVICE_SETUP_KEY, IO_MAPPING_KEY, MODULE_CONFIGURATION_KEY } from '../../../utils/vpp/persistence-keys'
import { defaultDeviceConfiguration } from './data/types'
import type { DeviceLicenseInfo, DeviceSlice, DeviceSliceRoot, PinUpdateResponse } from './types'
import { PURCHASE_WATCH_WINDOW_MS } from './types'
import {
  checkIfPinAliasIsValid,
  checkIfPinIsValid,
  createNewAddress,
  getHighestPinAddress,
  removeAddressPrefix,
} from './validation/pins'

/**
 * Lazily resolve the active board's pin array on an Immer draft, creating the entry the first time a board claims
 * pins.
 */
function getActivePinsDraft(draft: DeviceSlice): DevicePin[] {
  const board = draft.deviceDefinitions.configuration.deviceBoard
  if (!draft.deviceDefinitions.pinMapping.pinsByBoard[board]) {
    draft.deviceDefinitions.pinMapping.pinsByBoard[board] = []
  }
  return draft.deviceDefinitions.pinMapping.pinsByBoard[board]
}

/** Reset licensing to its initial state on an Immer draft — THE one way to drop a licence. */
function resetDeviceLicense(deviceLicense: DeviceLicenseInfo): void {
  deviceLicense.phase = 'idle'
  deviceLicense.report = null
  deviceLicense.awaitingPurchaseUntil = null
}

/** The only pin state the central IEC recalculation depends on: which addresses the pin block occupies, in order. */
function pinAddressSignature(state: DeviceSliceRoot): string {
  const board = state.deviceDefinitions.configuration.deviceBoard
  return (state.deviceDefinitions.pinMapping.pinsByBoard[board] ?? []).map((pin) => pin.address).join(',')
}

/**
 * Recompact the other producers around the new pin layout, but only when the pin addresses actually moved since
 * `before`.
 */
function recalcIfPinAddressesMoved(getState: () => DeviceSliceRoot, before: string): void {
  if (pinAddressSignature(getState()) !== before) {
    getState().projectActions.recalculateIecAddresses()
  }
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
    switchPosition: null,
    ipAddress: null,
    runtimeUpdateInProgress: false,
    runtimeVersion: null,
    runtimeFeatures: null,
    selectedDevice: null,
    storedCredentials: null,
    timingStats: null,
    includeTimingStatsInPolling: false,
    ethercatStatus: null,
    includeEthercatStatsInPolling: false,
  },
  deviceConnection: {
    status: 'disconnected',
    port: null,
    transport: null,
    debugTransport: null,
  },

  deviceLicense: {
    phase: 'idle',
    report: null,
    awaitingPurchaseUntil: null,
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
        produce(({ deviceDefinitions, runtimeConnection }: DeviceSlice) => {
          if (configuration) {
            deviceDefinitions.configuration = mergeDeviceConfigWithDefaults(configuration, defaultDeviceConfiguration)
            if (deviceDefinitions.configuration.runtimeIpAddress) {
              runtimeConnection.ipAddress = deviceDefinitions.configuration.runtimeIpAddress
            }
          }
          if (pinMapping) {
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
        produce(({ deviceDefinitions, runtimeConnection, deviceConnection, deviceLicense }: DeviceSlice) => {
          deviceDefinitions.configuration = defaultDeviceConfiguration
          deviceDefinitions.pinMapping = {
            pinsByBoard: {},
            currentSelectedPinTableRow: -1,
          }
          runtimeConnection.jwtToken = null
          runtimeConnection.connectionStatus = 'disconnected'
          runtimeConnection.plcStatus = null
          runtimeConnection.ipAddress = null
          runtimeConnection.runtimeVersion = null
          runtimeConnection.runtimeFeatures = null
          runtimeConnection.selectedDevice = null
          runtimeConnection.storedCredentials = null
          runtimeConnection.timingStats = null
          runtimeConnection.includeTimingStatsInPolling = false
          runtimeConnection.ethercatStatus = null
          runtimeConnection.includeEthercatStatsInPolling = false
          deviceConnection.status = 'disconnected'
          deviceConnection.port = null
          deviceConnection.transport = null
          deviceConnection.debugTransport = null
          resetDeviceLicense(deviceLicense)
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
      const pinsBefore = pinAddressSignature(getState())
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
      recalcIfPinAddressesMoved(getState, pinsBefore)
    },
    removePin: (): void => {
      const pinsBefore = pinAddressSignature(getState())
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
      recalcIfPinAddressesMoved(getState, pinsBefore)
    },
    updatePin: (updatedData): PinUpdateResponse => {
      const returnMessage: PinUpdateResponse = {
        ok: true,
        title: '',
        message: '',
        data: { pin: '', pinType: '', address: '', alias: '' },
      }
      const pinsBefore = pinAddressSignature(getState())
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

              case 'pull':
                currentPin.pull = updatedData.pull
                return

              default:
                break
            }
          }
        }),
      )
      recalcIfPinAddressesMoved(getState, pinsBefore)
      return returnMessage
    },
    setDeviceBoard: (deviceBoard): void => {
      const previousBoard = getState().deviceDefinitions.configuration.deviceBoard
      setState(
        produce(({ deviceDefinitions, deviceUpdated, deviceLicense }: DeviceSlice) => {
          deviceUpdated.updated = true
          if (deviceDefinitions.configuration.deviceBoard !== deviceBoard) {
            deviceDefinitions.configuration.selectedPlatformOptions = {}
            deviceDefinitions.pinMapping.currentSelectedPinTableRow = -1
            const cfg = deviceDefinitions.configuration
            syncActiveBoardVendorBucket(cfg)
            cfg.vendorScreenData = { ...(cfg.vendorScreenDataByBoard?.[deviceBoard] ?? {}) }
            syncActiveBoardPersistentStorage(cfg)
            cfg.persistentStorage = cfg.persistentStorageByBoard?.[deviceBoard]
            resetDeviceLicense(deviceLicense)
          }
          deviceDefinitions.configuration.deviceBoard = deviceBoard
        }),
      )
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
        produce(({ deviceDefinitions, deviceUpdated, deviceLicense }: DeviceSlice) => {
          deviceUpdated.updated = true
          if (deviceDefinitions.configuration.communicationPort !== communicationPort) resetDeviceLicense(deviceLicense)
          deviceDefinitions.configuration.communicationPort = communicationPort
        }),
      )
    },
    setRuntimeIpAddress: (ipAddress, options): void => {
      setState(
        produce(({ deviceDefinitions, runtimeConnection, deviceLicense }: DeviceSlice) => {
          if (!options?.sameDevice && deviceDefinitions.configuration.runtimeIpAddress !== ipAddress) {
            resetDeviceLicense(deviceLicense)
          }
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
    setRuntimeVersion: (version): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.runtimeVersion = version
        }),
      )
    },
    setRuntimeFeatures: (features): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.runtimeFeatures = features
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
    setPlcSwitchPosition: (position): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.switchPosition = position
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
    setTargetDevice: (target): void => {
      const current = getState().deviceDefinitions.configuration.targetDevice
      const unchanged = target
        ? current?.orchestratorId === target.orchestratorId &&
          current.deviceId === target.deviceId &&
          current.deviceName === target.deviceName
        : current === undefined
      if (unchanged) return
      setState(
        produce((draft: DeviceSlice) => {
          if (target) draft.deviceDefinitions.configuration.targetDevice = { ...target }
          else delete draft.deviceDefinitions.configuration.targetDevice
          draft.deviceUpdated.updated = true
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
    setRuntimeUpdateInProgress: (inProgress): void => {
      setState(
        produce(({ runtimeConnection }: DeviceSlice) => {
          runtimeConnection.runtimeUpdateInProgress = inProgress
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
          runtimeConnection.runtimeVersion = null
          runtimeConnection.runtimeFeatures = null
          runtimeConnection.selectedDevice = null
          runtimeConnection.storedCredentials = null
          runtimeConnection.timingStats = null
          runtimeConnection.includeTimingStatsInPolling = false
          runtimeConnection.ethercatStatus = null
          runtimeConnection.includeEthercatStatsInPolling = false
        }),
      )
    },
    setDeviceConnectionStatus: (status, port, transport, debugTransport): void => {
      setState(
        produce(({ deviceConnection }: DeviceSlice) => {
          deviceConnection.status = status
          if (port !== undefined) deviceConnection.port = port
          if (transport !== undefined) deviceConnection.transport = transport
          if (debugTransport !== undefined) deviceConnection.debugTransport = debugTransport
        }),
      )
    },
    clearDeviceConnection: (): void => {
      setState(
        produce(({ deviceConnection }: DeviceSlice) => {
          deviceConnection.status = 'disconnected'
          deviceConnection.port = null
          deviceConnection.transport = null
          deviceConnection.debugTransport = null
        }),
      )
    },
    startDeviceLicenseCheck: (): void => {
      setState(
        produce(({ deviceLicense }: DeviceSlice) => {
          deviceLicense.phase = 'checking'
        }),
      )
    },
    setDeviceLicenseReport: (report): void => {
      setState(
        produce(({ deviceLicense }: DeviceSlice) => {
          deviceLicense.phase = 'done'
          deviceLicense.report = report
        }),
      )
    },
    setAwaitingPurchase: (awaiting): void => {
      setState(
        produce(({ deviceLicense }: DeviceSlice) => {
          deviceLicense.awaitingPurchaseUntil = awaiting ? Date.now() + PURCHASE_WATCH_WINDOW_MS : null
        }),
      )
    },
    clearDeviceLicense: (): void => {
      setState(
        produce(({ deviceLicense }: DeviceSlice) => {
          resetDeviceLicense(deviceLicense)
        }),
      )
    },
    setPersistentStorage: (patch): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          const cfg = deviceDefinitions.configuration
          cfg.persistentStorage = {
            enabled: false,
            path: '',
            flushSeconds: DEFAULT_RETAIN_FLUSH_SECONDS,
            ...cfg.persistentStorage,
            ...patch,
          }
          syncActiveBoardPersistentStorage(cfg)
        }),
      )
    },
    setVppPackagePin: (board, pin): void => {
      const existing = getState().deviceDefinitions.configuration.vppPackagePinsByBoard?.[board]
      if (pin === null) {
        if (!existing) return
      } else if (
        existing &&
        existing.packageId === pin.packageId &&
        existing.version === pin.version &&
        existing.contentHash === pin.contentHash
      ) {
        return
      }

      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          const pins = deviceDefinitions.configuration.vppPackagePinsByBoard ?? {}
          if (pin === null) {
            delete pins[board]
          } else {
            pins[board] = pin
          }
          deviceDefinitions.configuration.vppPackagePinsByBoard = pins
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
          deviceDefinitions.configuration.vendorScreenData[persistenceKey] =
            persistenceKey === SERIAL_SCREEN_STATE_KEY ? withoutLegacyRs485Pin(data) : data
          syncActiveBoardVendorBucket(deviceDefinitions.configuration)
        }),
      )
    },
    setConfiguratorSnapshot: (configuratorKey, snapshot): void => {
      setState(
        produce(({ deviceDefinitions, deviceUpdated }: DeviceSlice) => {
          deviceUpdated.updated = true
          if (!deviceDefinitions.configuration.vendorScreenData) {
            deviceDefinitions.configuration.vendorScreenData = {}
          }
          const target = deviceDefinitions.configuration.vendorScreenData
          target[configuratorKey] = snapshot.configurator
          target[DEVICE_SETUP_KEY] = snapshot.deviceSetup
          target[MODULE_CONFIGURATION_KEY] = snapshot.moduleConfiguration
          target[IO_MAPPING_KEY] = snapshot.ioMapping
          syncActiveBoardVendorBucket(deviceDefinitions.configuration)
        }),
      )
    },
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
 * Keep the active board's bucket in `persistentStorageByBoard` in lock-step with the flat `persistentStorage` view,
 * exactly as the vendor-screen sibling below does.
 */
function syncActiveBoardPersistentStorage(configuration: DeviceConfiguration): void {
  if (!configuration.persistentStorageByBoard) {
    configuration.persistentStorageByBoard = {}
  }
  if (configuration.persistentStorage) {
    configuration.persistentStorageByBoard[configuration.deviceBoard] = { ...configuration.persistentStorage }
  }
}

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

/** Like `migrateVendorScreenData`; absent stays absent so no retain.conf is emitted. */
function migratePersistentStorage(
  provided: Partial<DeviceConfiguration>,
  deviceBoard: string,
): Pick<DeviceConfiguration, 'persistentStorage' | 'persistentStorageByBoard'> {
  const flat = provided.persistentStorage
  const archive = provided.persistentStorageByBoard

  if (archive && Object.keys(archive).length > 0) {
    const active = archive[deviceBoard] ?? flat
    return {
      persistentStorage: active ? { ...active } : undefined,
      persistentStorageByBoard: active ? { ...archive, [deviceBoard]: { ...active } } : { ...archive },
    }
  }

  if (flat) {
    return { persistentStorage: { ...flat }, persistentStorageByBoard: { [deviceBoard]: { ...flat } } }
  }

  return { persistentStorage: undefined, persistentStorageByBoard: undefined }
}

function mergeDeviceConfigWithDefaults(
  provided: Partial<DeviceConfiguration>,
  defaults: DeviceConfiguration,
): DeviceConfiguration {
  const deviceBoard = provided.deviceBoard || defaults.deviceBoard
  const { vendorScreenData, vendorScreenDataByBoard } = migrateVendorScreenData(provided, deviceBoard)
  const { persistentStorage, persistentStorageByBoard } = migratePersistentStorage(provided, deviceBoard)
  return {
    deviceBoard,
    communicationPort: provided.communicationPort ?? defaults.communicationPort,
    runtimeIpAddress: provided.runtimeIpAddress ?? defaults.runtimeIpAddress,
    vendorScreenData,
    vendorScreenDataByBoard,
    selectedPlatformOptions: provided.selectedPlatformOptions ?? defaults.selectedPlatformOptions,
    vppPackagePinsByBoard: provided.vppPackagePinsByBoard ?? defaults.vppPackagePinsByBoard,
    ...(persistentStorage ? { persistentStorage } : {}),
    ...(persistentStorageByBoard ? { persistentStorageByBoard } : {}),
    ...(provided.targetDevice ? { targetDevice: { ...provided.targetDevice } } : {}),
  }
}

export { createDeviceSlice }
