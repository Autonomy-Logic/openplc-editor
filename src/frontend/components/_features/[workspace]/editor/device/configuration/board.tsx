/* eslint-disable @typescript-eslint/no-misused-promises */
import { describeVppPinDrift, type VppPackagePin } from '@root/backend/shared/utils/vpp/vpp-package-pin'
import type { RuntimeProvisioningOperation } from '@root/middleware/shared/ports/runtime-provisioning-port'
import { useCapabilities, useDevice, usePackages } from '@root/middleware/shared/providers/platform-context'
import { evaluateVppBackplaneGate, vppGateStateFor } from '@root/middleware/shared/utils/build-gate/vpp-backplane-gate'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MagnifierIcon } from '../../../../../../assets/icons/interface/Magnifier'
import { MinusIcon } from '../../../../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../../../../assets/icons/interface/Plus'
import { RefreshIcon } from '../../../../../../assets/icons/interface/Refresh'
import { useDeviceConnect } from '../../../../../../hooks/use-device-connect'
import { useDeviceLicense } from '../../../../../../hooks/use-device-license'
import { useRuntimeConnect } from '../../../../../../hooks/use-runtime-connect'
import { boardSelectors, pinSelectors } from '../../../../../../hooks/use-store-selectors'
import { reopenProvisioningDialog } from '../../../../../../services/runtime-provisioning'
import { useOpenPLCStore, useOpenPLCStoreApi } from '../../../../../../store'
import type { ConnectionStatus, RuntimeConnection } from '../../../../../../store/slices/device/types'
import type { RuntimeProvisioningView } from '../../../../../../store/slices/runtime-provisioning/types'
import { cn } from '../../../../../../utils/cn'
import { isEthernetUploadTarget, isOpenPLCRuntimeTarget, isSimulatorTarget } from '../../../../../../utils/device'
import { explainLicenseOutcome } from '../../../../../../utils/license-outcome-dialog'
import { serialPortDisplay } from '../../../../../../utils/serial-port-label'
import { DropdownSearchInput } from '../../../../../_atoms/dropdown-search-input'
import { Label } from '../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import TableActions from '../../../../../_atoms/table-actions'
import { DeviceConnectButton } from '../../../../../_molecules/device-connect-button'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../../../../_molecules/modal'
import { DeviceEditorSlot } from '../../../../../_templates/[editors]/device-editor-slot'
import { DeviceLicenseStatus } from './components/device-license-status'
import { PinMappingTable } from './components/pin-mapping-table'

type RuntimeConnectActivity = {
  label: string
  onClick: () => void
}

const RUNNING_OPERATION_LABELS: Record<RuntimeProvisioningOperation, string> = {
  install: 'Installing runtime...',
  start: 'Starting runtime...',
}

const PREPARING_RUNTIME_LABEL = 'Preparing runtime...'
const SHOW_RESULT_LABEL = 'Show result'

function runtimeProvisioningActivity(
  view: RuntimeProvisioningView,
  connectionStatus: ConnectionStatus,
  reopenDialog: () => void,
): RuntimeConnectActivity | undefined {
  if (view.stage === 'running') {
    const label = view.operation === null ? PREPARING_RUNTIME_LABEL : RUNNING_OPERATION_LABELS[view.operation]
    return { label, onClick: reopenDialog }
  }
  const showsResult =
    view.stage === 'ended' &&
    view.outcome.kind !== 'connected-ready' &&
    !view.acknowledged &&
    connectionStatus !== 'connected'
  if (showsResult) {
    return { label: SHOW_RESULT_LABEL, onClick: reopenDialog }
  }
  return undefined
}

const Board = memo(function () {
  const store = useOpenPLCStoreApi()
  const capabilities = useCapabilities()
  const device = useDevice()
  const packages = usePackages()

  const {
    deviceAvailableOptions: { availableBoards },
    project: {
      data: { pous, servers, remoteDevices },
    },
  } = useOpenPLCStore()
  const availableCommunicationPorts = boardSelectors.useAvailableCommunicationPorts()
  const deviceBoard = boardSelectors.useDeviceBoard()
  const communicationPort = boardSelectors.useCommunicationPort()
  const setDeviceBoard = boardSelectors.useSetDeviceBoard()
  const setCommunicationPort = boardSelectors.useSetCommunicationPort()
  const setAvailableOptions = boardSelectors.useSetAvailableOptions()
  const currentSelectedPinTableRow = pinSelectors.useCurrentSelectedPinTableRow()
  const setCurrentSelectedPinTableRow = pinSelectors.useSelectPinTableRow()

  const pins = pinSelectors.usePins()
  const createNewPin = pinSelectors.useCreateNewPin()
  const removePin = pinSelectors.useRemovePin()

  const currentBoardInfo = availableBoards.get(deviceBoard)

  const {
    connect: connectDevice,
    disconnect: disconnectDevice,
    isConnected,
    status: deviceLinkStatus,
  } = useDeviceConnect(currentBoardInfo)

  const licensing = useDeviceLicense(currentBoardInfo, { ownsWatch: true })

  const pinMappingEnabled = resolveTargetCapabilities(currentBoardInfo).pinMapping

  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress || '')
  const modbusTcpConfigured = useOpenPLCStore(
    (state) =>
      (
        (state.deviceDefinitions.configuration.vendorScreenData ?? {}) as Record<
          string,
          Record<string, unknown> | undefined
        >
      )['modbus_tcp']?.['enabled'] === true,
  )
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const provisioningView = useOpenPLCStore((state) => state.runtimeProvisioning.view)
  const setRuntimeIpAddress = useOpenPLCStore((state) => state.deviceActions.setRuntimeIpAddress)
  const setVppPackagePin = useOpenPLCStore((state) => state.deviceActions.setVppPackagePin)
  const recordedPins = useOpenPLCStore(
    (state): Record<string, VppPackagePin> | undefined => state.deviceDefinitions.configuration.vppPackagePinsByBoard,
  )
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const selectedDevice = useOpenPLCStore(
    (state): RuntimeConnection['selectedDevice'] => state.runtimeConnection.selectedDevice,
  )

  const [isPressed, setIsPressed] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [pinDrift, setPinDrift] = useState<string | null>(null)
  const [formattedBoardState, setFormattedBoardState] = useState('')
  const [showPythonWarning, setShowPythonWarning] = useState(false)
  const [unsupportedBlocksLabel, setUnsupportedBlocksLabel] = useState('Python')
  const [showV4FeaturesWarning, setShowV4FeaturesWarning] = useState(false)
  const [v4FeaturesAffected, setV4FeaturesAffected] = useState<{ hasServers: boolean; hasRemoteDevices: boolean }>({
    hasServers: false,
    hasRemoteDevices: false,
  })
  const [pendingBoardChange, setPendingBoardChange] = useState<{ board: string; formattedBoard: string } | null>(null)

  const [deviceSelectIsOpen, setDeviceSelectIsOpen] = useState(false)
  const deviceSelectRef = useRef<HTMLDivElement>(null)
  const [deviceSearchTerm, setDeviceSearchTerm] = useState('')
  const deviceSearchInputRef = useRef<HTMLInputElement>(null)

  const groupedBoards = useMemo(() => {
    type BoardInfo = NonNullable<ReturnType<typeof availableBoards.get>>
    const groups = new Map<string, Array<{ board: string; data: BoardInfo }>>()
    const BUILT_IN_VENDOR = 'OpenPLC'
    for (const [board, data] of availableBoards.entries()) {
      const vendor = data.vpp?.vendor ?? BUILT_IN_VENDOR
      const bucket = groups.get(vendor) ?? []
      bucket.push({ board, data })
      groups.set(vendor, bucket)
    }
    const builtIn = groups.get(BUILT_IN_VENDOR) ?? []
    groups.delete(BUILT_IN_VENDOR)
    const orderedVendors = [...groups.keys()].sort((a, b) => a.localeCompare(b))
    const ordered: Array<{ vendor: string; boards: typeof builtIn }> = []
    if (builtIn.length > 0) ordered.push({ vendor: BUILT_IN_VENDOR, boards: builtIn })
    for (const vendor of orderedVendors) ordered.push({ vendor, boards: groups.get(vendor)! })

    const needle = deviceSearchTerm.trim().toLowerCase()
    if (!needle) return ordered
    return ordered
      .map(({ vendor, boards }) => {
        const vendorMatches = vendor.toLowerCase().includes(needle)
        const matching = vendorMatches ? boards : boards.filter(({ board }) => board.toLowerCase().includes(needle))
        return { vendor, boards: matching }
      })
      .filter(({ boards }) => boards.length > 0)
  }, [availableBoards, deviceSearchTerm])

  const [communicationSelectIsOpen, setCommunicationSelectIsOpen] = useState(false)
  const communicationSelectRef = useRef<HTMLDivElement>(null)
  const portsReqIdRef = useRef<number>(0)
  const [isRefreshingPorts, setIsRefreshingPorts] = useState(false)

  const scrollToSelectedOption = (selectRef: React.RefObject<HTMLDivElement>, selectIsOpen: boolean) => {
    if (!selectIsOpen) return

    const checkedElement = selectRef.current?.querySelector('[data-state="checked"]')
    if (!checkedElement) return

    const groupContainer = checkedElement.closest('[data-board-group]')
    if (groupContainer) {
      groupContainer.scrollIntoView({ block: 'start' })
    } else {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }

  useEffect(() => {
    const handleDeviceValueAtFirstRender = () => {
      const boardInfos = availableBoards.get(deviceBoard)
      if (boardInfos) {
        const showVersion = !isSimulatorTarget(boardInfos) && boardInfos.coreVersion
        const coreVersionAsString = showVersion ? ` [${boardInfos.coreVersion}]` : ''
        const initialBoard = `${deviceBoard}${coreVersionAsString}`
        if (initialBoard === formattedBoardState) return
        setFormattedBoardState(initialBoard)
      }
    }
    handleDeviceValueAtFirstRender()
  }, [])

  const boardIsUnavailable = deviceBoard !== '' && currentBoardInfo === undefined
  useEffect(() => {
    if (boardIsUnavailable) setFormattedBoardState(deviceBoard)
  }, [boardIsUnavailable, deviceBoard])

  useEffect(() => {
    scrollToSelectedOption(deviceSelectRef, deviceSelectIsOpen)
  }, [deviceSelectIsOpen])

  useEffect(() => {
    if (!deviceSelectIsOpen) return
    const input = deviceSearchInputRef.current
    if (!input) return
    const handler = () => {
      if (deviceSearchTerm.length === 0) return
      queueMicrotask(() => deviceSearchInputRef.current?.focus())
    }
    input.addEventListener('focusout', handler)
    return () => input.removeEventListener('focusout', handler)
  }, [deviceSelectIsOpen, deviceSearchTerm])

  useEffect(() => {
    scrollToSelectedOption(communicationSelectRef, communicationSelectIsOpen)
  }, [communicationSelectIsOpen])

  useEffect(() => {
    const fetchPreviewImage = async () => {
      const boardInfos = availableBoards.get(deviceBoard)
      const imagePath = await device.getPreviewImage(boardInfos?.preview || 'generic.png', boardInfos?.vpp?.packagePath)
      setPreviewImage(imagePath)
    }
    void fetchPreviewImage()
  }, [deviceBoard, device, availableBoards])

  const vppPackageId = availableBoards.get(deviceBoard)?.vpp?.packageId
  const targetVpp = selectedDevice?.vpp
  useEffect(() => {
    if (!packages || !vppPackageId) {
      setPinDrift(null)
      return
    }
    let cancelled = false
    const authoritative =
      targetVpp !== undefined ? Promise.resolve<VppPackagePin | null>(targetVpp) : packages.getPackagePin(vppPackageId)
    void authoritative.then((installed) => {
      if (cancelled) return
      const recorded = recordedPins?.[deviceBoard]
      if (!recorded && installed) {
        setVppPackagePin(deviceBoard, installed)
        setPinDrift(null)
        return
      }
      setPinDrift(describeVppPinDrift(recorded, installed))
    })
    return () => {
      cancelled = true
    }
  }, [deviceBoard, vppPackageId, targetVpp, packages, recordedPins, setVppPackagePin])

  const refreshCommunicationPorts = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      if (isRefreshingPorts) return

      try {
        setIsRefreshingPorts(true)
        setIsPressed(true)

        portsReqIdRef.current += 1
        const currentReqId = portsReqIdRef.current

        const ports = await device.refreshCommunicationPorts()

        if (currentReqId === portsReqIdRef.current) {
          setAvailableOptions({ availableCommunicationPorts: ports })
        }
      } catch (error: unknown) {
        console.error(error)
      } finally {
        setIsRefreshingPorts(false)
        setTimeout(() => setIsPressed(false), 400)
      }
    },
    [device, setAvailableOptions, isRefreshingPorts],
  )

  const handleSetDeviceBoard = useCallback(
    (board: string) => {
      if (board === '__install_additional_boards__') {
        const { tabsActions, editorActions } = store.getState()
        const tab = {
          name: 'Package Manager',
          path: '/package-manager',
          elementType: { type: 'package-manager' as const },
        }
        tabsActions.updateTabs(tab)
        const existing = editorActions.getEditorFromEditors(tab.name)
        if (!existing) {
          const model = { type: 'plc-package-manager' as const, meta: { name: 'Package Manager' } }
          editorActions.addModel(model)
          editorActions.setEditor(model)
        } else {
          editorActions.setEditor(existing)
        }
        return
      }

      const normalizedBoard = board.split('[')[0].trim()

      if (connectionStatus === 'connected' && normalizedBoard !== deviceBoard) {
        openModal('confirm-device-switch', {
          newBoard: normalizedBoard,
          formattedNewBoard: board,
          onConfirm: () => {
            setFormattedBoardState(board)
            setDeviceBoard(normalizedBoard)
          },
        })
        return
      }

      const targetBoardInfo = availableBoards.get(normalizedBoard)
      const targetCaps = resolveTargetCapabilities(targetBoardInfo)
      const hasPythonFunctionBlocks = pous.some(
        (pou) => pou.pouType === 'function-block' && pou.body.language === 'python',
      )
      const hasCppFunctionBlocks = pous.some((pou) => pou.pouType === 'function-block' && pou.body.language === 'cpp')

      const isRuntimeV3Target = normalizedBoard === 'OpenPLC Runtime v3'
      const pythonUnsupported = (!targetCaps.pythonFunctionBlocks || isRuntimeV3Target) && hasPythonFunctionBlocks
      const cppUnsupported = isRuntimeV3Target && hasCppFunctionBlocks

      if (pythonUnsupported || cppUnsupported) {
        const label = [cppUnsupported ? 'C/C++' : null, pythonUnsupported ? 'Python' : null]
          .filter(Boolean)
          .join(' and ')
        setUnsupportedBlocksLabel(label)
        setPendingBoardChange({ board: normalizedBoard, formattedBoard: board })
        setShowPythonWarning(true)
        return
      }

      const hasServers = servers && servers.length > 0
      const hasRemoteDevices = remoteDevices && remoteDevices.length > 0
      const targetCantHostServers = !targetCaps.modbusTcpServer && !targetCaps.opcuaServer && !targetCaps.s7Server
      const targetCantHostRemoteIo = !targetCaps.modbusTcpRemote && !targetCaps.ethercat

      const losingServers = hasServers && targetCantHostServers
      const losingRemoteIo = hasRemoteDevices && targetCantHostRemoteIo

      if (losingServers || losingRemoteIo) {
        setPendingBoardChange({ board: normalizedBoard, formattedBoard: board })
        setV4FeaturesAffected({ hasServers: !!losingServers, hasRemoteDevices: !!losingRemoteIo })
        setShowV4FeaturesWarning(true)
        return
      }

      setFormattedBoardState(board)
      setDeviceBoard(normalizedBoard)
    },
    [
      store,
      connectionStatus,
      deviceBoard,
      setDeviceBoard,
      setFormattedBoardState,
      openModal,
      pous,
      servers,
      remoteDevices,
      availableBoards,
    ],
  )
  const handleRowClick = (row: HTMLTableRowElement) => setCurrentSelectedPinTableRow(parseInt(row.id))

  const { toggle: handleConnectToRuntime } = useRuntimeConnect()
  const runtimeActivity = useMemo(
    () => runtimeProvisioningActivity(provisioningView, connectionStatus, () => reopenProvisioningDialog(store)),
    [provisioningView, connectionStatus, store],
  )

  const runtimeLicenseSettledForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isOpenPLCRuntimeTarget(currentBoardInfo) || !licensing.isLicensable) return
    if (!device.refreshLicense) return
    if (connectionStatus !== 'connected' || deviceLinkStatus !== 'connected') {
      runtimeLicenseSettledForRef.current = null
      return
    }
    if (runtimeLicenseSettledForRef.current === deviceBoard) return
    runtimeLicenseSettledForRef.current = deviceBoard
    let cancelled = false
    void licensing.refresh().then((report) => {
      if (cancelled || !report) return
      explainLicenseOutcome(report, {
        openModal,
        buy: licensing.buy,
        quietCheckFailed: true,
        retry: async () => {
          const next = await licensing.refresh()
          if (next && !cancelled) {
            explainLicenseOutcome(next, { openModal, buy: licensing.buy })
          }
        },
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    connectionStatus,
    deviceLinkStatus,
    currentBoardInfo,
    deviceBoard,
    device.refreshLicense,
    licensing.isLicensable,
    licensing.refresh,
    licensing.buy,
    openModal,
  ])

  return (
    <DeviceEditorSlot>
      <div id='board-selection-container' className='flex w-full flex-wrap items-start gap-8 lg:gap-16'>
        <div
          id='board-preferences-container'
          className='flex w-[360px] flex-shrink-0 flex-col items-start justify-start gap-3'
        >
          <h2 id='slot-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
            Board Settings
          </h2>
          <div id='board-selector' className='flex w-full items-center justify-start gap-1 pr-5'>
            <Label id='device-selector-label' className='w-fit text-xs text-neutral-950 dark:text-white'>
              Device
            </Label>
            <Select
              value={formattedBoardState}
              onValueChange={handleSetDeviceBoard}
              onOpenChange={(open) => {
                setDeviceSelectIsOpen(open)
                if (!open) setDeviceSearchTerm('')
              }}
            >
              <SelectTrigger
                aria-label='Device selection'
                placeholder={formattedBoardState}
                withIndicator
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent
                className='max-h-[300px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                sideOffset={5}
                alignOffset={5}
                position='popper'
                align='center'
                side='bottom'
                viewportRef={deviceSelectRef}
                disableTypeahead
              >
                <DropdownSearchInput
                  ref={deviceSearchInputRef}
                  value={deviceSearchTerm}
                  onChange={(e) => setDeviceSearchTerm(e.target.value)}
                  aria-label='Search devices'
                />
                {boardIsUnavailable && (
                  <SelectItem
                    key={deviceBoard}
                    value={deviceBoard}
                    disabled
                    className='flex w-full cursor-not-allowed items-center px-2 py-[7px] pl-5 opacity-60 outline-none'
                  >
                    <span className='flex flex-col gap-0.5'>
                      <span className='font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                        {deviceBoard}
                      </span>
                      <span className='font-caption text-[10px] leading-snug text-neutral-500 dark:text-neutral-400'>
                        {evaluateVppBackplaneGate(
                          vppGateStateFor({
                            board: undefined,
                            boardName: deviceBoard,
                            target: selectedDevice,
                            vplcProvidesVendorBoards: capabilities.hasOrchestratorDevices,
                          }),
                        ).kind === 'refuse'
                          ? 'Not available on the selected vPLC. Select a vPLC created with the package this board comes from.'
                          : 'Not available. The package this board comes from is not installed.'}
                      </span>
                    </span>
                  </SelectItem>
                )}
                {groupedBoards.length === 0 ? (
                  <div className='px-3 py-6 text-center text-[11px] italic text-neutral-500 dark:text-neutral-400'>
                    No devices match “{deviceSearchTerm}”.
                  </div>
                ) : (
                  groupedBoards.map(({ vendor, boards }) => (
                    <div key={vendor} data-board-group className='py-1'>
                      <div className='select-none px-2 py-1 font-caption text-[10px] font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
                        {vendor}
                      </div>
                      {boards.map(({ board, data }) => {
                        const showVersion = !isSimulatorTarget(data) && data.coreVersion
                        const formattedBoard = `${board}${showVersion ? ` [${data.coreVersion}]` : ''}`
                        const gate = evaluateVppBackplaneGate(
                          vppGateStateFor({
                            board: data,
                            target: selectedDevice,
                            vplcProvidesVendorBoards: capabilities.hasOrchestratorDevices,
                          }),
                        )
                        const refusal = gate.kind === 'refuse' ? gate.reason : null
                        return (
                          <SelectItem
                            key={board}
                            disabled={refusal !== null}
                            className={cn(
                              'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                              'flex w-full cursor-pointer items-center px-2 py-[7px] pl-5 outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                              refusal !== null &&
                                'cursor-not-allowed opacity-60 hover:bg-transparent dark:hover:bg-transparent',
                            )}
                            value={formattedBoard}
                          >
                            <span className='flex flex-col gap-0.5'>
                              <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                                {formattedBoard}
                              </span>
                              {refusal !== null && (
                                <span className='font-caption text-[10px] leading-snug text-neutral-500 dark:text-neutral-400'>
                                  {refusal}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        )
                      })}
                    </div>
                  ))
                )}
                {capabilities.hasPackageManager && (
                  <>
                    <div className='my-1 border-t border-neutral-200 dark:border-neutral-700' />
                    <SelectItem
                      value='__install_additional_boards__'
                      className='flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850'
                    >
                      <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-brand'>
                        + Install additional boards...
                      </span>
                    </SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
          {isSimulatorTarget(currentBoardInfo) ? (
            <div id='simulator-info' className='flex w-full flex-col items-start justify-start gap-4'>
              <p className='text-xs text-neutral-600 dark:text-neutral-400'>
                Built-in simulator — no configuration required. Press Build to compile and run.
              </p>
            </div>
          ) : isOpenPLCRuntimeTarget(currentBoardInfo) ? (
            <>
              <div id='runtime-ip-address-field' className='flex w-full items-center justify-start gap-1'>
                <Label
                  id='runtime-ip-address-label'
                  className='whitespace-pre text-xs text-neutral-950 dark:text-white'
                >
                  IP Address
                </Label>
                <input
                  type='text'
                  value={runtimeIpAddress}
                  onChange={(e) => setRuntimeIpAddress(e.target.value)}
                  placeholder='127.0.0.1 or localhost'
                  className='flex h-[30px] min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <button
                  type='button'
                  aria-label='Search for devices'
                  title='Search for devices on the local network'
                  onClick={() => openModal('runtime-discover-devices', null)}
                  className='flex h-[30px] items-center gap-1 rounded-md bg-neutral-100 px-3 font-caption text-cp-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
                >
                  <MagnifierIcon size='sm' className='h-4 w-4 stroke-neutral-1000 dark:stroke-neutral-100' />
                  Search
                </button>
              </div>
              <DeviceConnectButton
                containerId='runtime-connect-button-container'
                status={connectionStatus}
                onConnect={handleConnectToRuntime}
                onDisconnect={handleConnectToRuntime}
                activity={runtimeActivity}
              >
                {connectionStatus === 'connected' && plcStatus && (
                  <span className='text-xs text-neutral-600 dark:text-neutral-400'>PLC: {plcStatus}</span>
                )}
                {licensing.isLicensable ? (
                  <DeviceLicenseStatus
                    report={licensing.report}
                    isChecking={licensing.isChecking}
                    buyUrl={licensing.buyUrl}
                    awaitingPurchase={licensing.awaitingPurchase}
                    onBuy={() => void licensing.buy()}
                    onRecheck={() => void licensing.refresh()}
                    onCancelPurchaseWatch={licensing.cancelPurchaseWatch}
                  />
                ) : null}
              </DeviceConnectButton>
            </>
          ) : isEthernetUploadTarget(currentBoardInfo) ? (
            <>
              <div id='device-ip-address-field' className='flex w-full items-center justify-start gap-1'>
                <Label className='whitespace-pre text-xs text-neutral-950 dark:text-white'>IP Address</Label>
                <input
                  type='text'
                  value={runtimeIpAddress}
                  onChange={(e) => setRuntimeIpAddress(e.target.value)}
                  placeholder='192.168.0.2'
                  className='flex h-[30px] min-w-0 flex-1 items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
                <button
                  type='button'
                  aria-label='Search for devices'
                  title='Search for devices on the local network'
                  onClick={() => openModal('runtime-discover-devices', null)}
                  className='flex h-[30px] items-center gap-1 rounded-md bg-neutral-100 px-3 font-caption text-cp-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
                >
                  <MagnifierIcon size='sm' className='h-4 w-4 stroke-neutral-1000 dark:stroke-neutral-100' />
                  Search
                </button>
              </div>
              <DeviceConnectButton
                containerId='device-connect-button-container'
                status={deviceLinkStatus}
                onConnect={connectDevice}
                onDisconnect={disconnectDevice}
              >
                {licensing.isLicensable ? (
                  <DeviceLicenseStatus
                    report={licensing.report}
                    isChecking={licensing.isChecking}
                    buyUrl={licensing.buyUrl}
                    awaitingPurchase={licensing.awaitingPurchase}
                    onBuy={() => void licensing.buy()}
                    onRecheck={() => void licensing.refresh()}
                    onCancelPurchaseWatch={licensing.cancelPurchaseWatch}
                  />
                ) : null}
              </DeviceConnectButton>
            </>
          ) : capabilities.hasLocalSerialPorts ? (
            <>
              <div id='communication-ports-selector' className='flex w-full items-center justify-start gap-1'>
                <Label
                  id='communication-ports-selector-label'
                  className='whitespace-pre text-xs text-neutral-950 dark:text-white'
                >
                  Communication Port
                </Label>
                <Select
                  value={communicationPort}
                  onValueChange={setCommunicationPort}
                  onOpenChange={setCommunicationSelectIsOpen}
                >
                  <SelectTrigger
                    aria-label='Communication port selection'
                    placeholder='Select a communication port'
                    withIndicator
                    className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                  />
                  <SelectContent
                    className='h-fit max-h-[250px] w-[--radix-select-trigger-width] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                    sideOffset={5}
                    alignOffset={5}
                    position='popper'
                    align='center'
                    side='bottom'
                    viewportRef={communicationSelectRef}
                  >
                    {availableCommunicationPorts.map((port) => {
                      const { label, title } = serialPortDisplay(port)
                      return (
                        <SelectItem
                          key={port.address}
                          className={cn(
                            'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                            'flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                          )}
                          value={port.address}
                          title={title}
                        >
                          <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                            {label}
                          </span>
                        </SelectItem>
                      )
                    })}
                  </SelectContent>
                </Select>
                <button
                  type='button'
                  onClick={refreshCommunicationPorts}
                  disabled={isRefreshingPorts}
                  className={cn('group', isRefreshingPorts && 'cursor-not-allowed opacity-50')}
                  aria-pressed={isPressed}
                  aria-label='Refresh communication ports'
                >
                  <RefreshIcon size='sm' className={isPressed ? 'spin-refresh' : ''} />
                </button>
              </div>
              <DeviceConnectButton
                containerId='device-connect-button-container'
                status={deviceLinkStatus}
                onConnect={connectDevice}
                onDisconnect={disconnectDevice}
                {...(!isConnected && !communicationPort && !modbusTcpConfigured
                  ? { blockedReason: 'Select a communication port first' }
                  : {})}
              >
                {licensing.isLicensable ? (
                  <DeviceLicenseStatus
                    report={licensing.report}
                    isChecking={licensing.isChecking}
                    buyUrl={licensing.buyUrl}
                    awaitingPurchase={licensing.awaitingPurchase}
                    onBuy={() => void licensing.buy()}
                    onRecheck={() => void licensing.refresh()}
                    onCancelPurchaseWatch={licensing.cancelPurchaseWatch}
                  />
                ) : null}
              </DeviceConnectButton>
            </>
          ) : null}
          {!isOpenPLCRuntimeTarget(currentBoardInfo) && !isSimulatorTarget(currentBoardInfo) && (
            <div id='board-specs' className='flex w-full flex-col items-start justify-start gap-4'>
              <Label id='board-specs-label' className='w-fit text-xs text-neutral-950 dark:text-white'>
                Specs
              </Label>
              <div id='board-specs-container' className='grid grid-cols-2 place-content-around gap-2'>
                {Object.entries(availableBoards.get(deviceBoard)?.specs || {}).map(([spec, value]) => (
                  <p
                    className='text-start font-caption text-cp-sm font-semibold text-neutral-850 dark:text-white'
                    key={spec}
                  >
                    {spec}: <span className='font-light text-neutral-600 dark:text-neutral-400'>{value}</span>
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
        <div id='board-preview-container' className='flex flex-shrink-0 items-start'>
          <div className='h-[16rem] w-[20rem]'>
            <img src={previewImage} alt='Device preview' className='h-full w-full object-contain' />
          </div>
        </div>
      </div>
      {pinDrift && (
        <div
          data-testid='vpp-pin-drift'
          className='mt-3 rounded-md border border-amber-400/50 bg-amber-400/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400'
        >
          {pinDrift}
        </div>
      )}
      {(() => {
        const isSim = isSimulatorTarget(currentBoardInfo)
        const showDivider = !isSim && pinMappingEnabled
        return showDivider ? <hr id='container-split' className='h-[1px] w-full self-stretch bg-brand-light' /> : null
      })()}
      {!isSimulatorTarget(currentBoardInfo) && pinMappingEnabled && (
        <div id='pin-mapping-container' className='flex h-3/5 w-full flex-col gap-4'>
          <div id='pin-mapping-table-header-container' className='flex h-fit w-full justify-between'>
            <h2 id='slot-title' className='select-none text-lg font-medium text-neutral-950 dark:text-white'>
              Pin Mapping
            </h2>
            <TableActions
              className='w-fit *:rounded-md *:p-1'
              actions={[
                {
                  ariaLabel: 'Add table row button',
                  onClick: createNewPin,
                  icon: <PlusIcon className='!stroke-brand' />,
                  id: 'add-pin-button',
                },
                {
                  ariaLabel: 'Remove table row button',
                  onClick: removePin,
                  disabled: currentSelectedPinTableRow === -1,
                  icon: <MinusIcon className='!stroke-brand' />,
                  id: 'remove-pin-button',
                },
              ]}
            />
          </div>
          <PinMappingTable pins={pins} handleRowClick={handleRowClick} selectedRowId={currentSelectedPinTableRow} />
        </div>
      )}
      <Modal open={showPythonWarning} onOpenChange={setShowPythonWarning}>
        <ModalContent className='h-fit w-[500px]'>
          <ModalHeader>
            <ModalTitle>{unsupportedBlocksLabel} Function Blocks Not Supported</ModalTitle>
          </ModalHeader>
          <div className='flex flex-col gap-4'>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              The selected target ({pendingBoardChange?.formattedBoard}) does not support {unsupportedBlocksLabel}{' '}
              Function Blocks.
            </p>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              Your project contains {unsupportedBlocksLabel} Function Blocks that will cause compilation to fail on this
              target. To use this target, you must remove all {unsupportedBlocksLabel} Function Blocks from your
              project.
            </p>
          </div>
          <ModalFooter className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => {
                setShowPythonWarning(false)
                setPendingBoardChange(null)
              }}
              className='h-8 rounded-md bg-neutral-100 px-4 font-caption text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-white dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => {
                if (pendingBoardChange) {
                  setFormattedBoardState(pendingBoardChange.formattedBoard)
                  setDeviceBoard(pendingBoardChange.board)
                }
                setShowPythonWarning(false)
                setPendingBoardChange(null)
              }}
              className='h-8 rounded-md bg-brand px-4 font-caption text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              Continue Anyway
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      <Modal open={showV4FeaturesWarning} onOpenChange={setShowV4FeaturesWarning}>
        <ModalContent className='h-fit w-[500px]'>
          <ModalHeader>
            <ModalTitle>
              {v4FeaturesAffected.hasServers && v4FeaturesAffected.hasRemoteDevices
                ? 'Modbus Server and Remote IO Not Supported'
                : v4FeaturesAffected.hasServers
                  ? 'Modbus Server Not Supported'
                  : 'Remote IO Not Supported'}
            </ModalTitle>
          </ModalHeader>
          <div className='flex flex-col gap-4'>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              The selected target ({pendingBoardChange?.formattedBoard}) does not support{' '}
              {v4FeaturesAffected.hasServers && v4FeaturesAffected.hasRemoteDevices
                ? 'Modbus Server and Remote IO configurations'
                : v4FeaturesAffected.hasServers
                  ? 'Modbus Server configuration'
                  : 'Remote IO configuration'}
              .
            </p>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              Your project contains{' '}
              {v4FeaturesAffected.hasServers && v4FeaturesAffected.hasRemoteDevices
                ? 'Modbus Server and Remote IO configurations that will be disabled'
                : v4FeaturesAffected.hasServers
                  ? 'Modbus Server configurations that will be disabled'
                  : 'Remote IO configurations that will be disabled'}{' '}
              during compilation on this target.{' '}
              {v4FeaturesAffected.hasServers && v4FeaturesAffected.hasRemoteDevices
                ? 'Modbus Server and Remote IO are'
                : v4FeaturesAffected.hasServers
                  ? 'Modbus Server is'
                  : 'Remote IO is'}{' '}
              only supported on OpenPLC Runtime v4.
            </p>
          </div>
          <ModalFooter className='flex justify-end gap-2'>
            <button
              type='button'
              onClick={() => {
                setShowV4FeaturesWarning(false)
                setPendingBoardChange(null)
              }}
              className='h-8 rounded-md bg-neutral-100 px-4 font-caption text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-white dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
            <button
              type='button'
              onClick={() => {
                if (pendingBoardChange) {
                  setFormattedBoardState(pendingBoardChange.formattedBoard)
                  setDeviceBoard(pendingBoardChange.board)
                }
                setShowV4FeaturesWarning(false)
                setPendingBoardChange(null)
              }}
              className='h-8 rounded-md bg-brand px-4 font-caption text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              Continue Anyway
            </button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </DeviceEditorSlot>
  )
})

export { Board }
