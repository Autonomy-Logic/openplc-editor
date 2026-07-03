/* eslint-disable @typescript-eslint/no-misused-promises */
import type { TimingStats } from '@root/middleware/shared/ports/types'
import { useCapabilities, useDevice, useRuntime } from '@root/middleware/shared/providers/platform-context'
import { resolveTargetCapabilities } from '@root/middleware/shared/utils/target-capabilities'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { MagnifierIcon } from '../../../../../../assets/icons/interface/Magnifier'
import { MinusIcon } from '../../../../../../assets/icons/interface/Minus'
import { PlusIcon } from '../../../../../../assets/icons/interface/Plus'
import { RefreshIcon } from '../../../../../../assets/icons/interface/Refresh'
import { boardSelectors, pinSelectors } from '../../../../../../hooks/use-store-selectors'
import { useOpenPLCStore } from '../../../../../../store'
import type { RuntimeConnection } from '../../../../../../store/slices/device/types'
import { cn } from '../../../../../../utils/cn'
import { isOpenPLCRuntimeTarget, isSimulatorTarget, validateRuntimeVersion } from '../../../../../../utils/device'
import { DropdownSearchInput } from '../../../../../_atoms/dropdown-search-input'
import { Label } from '../../../../../_atoms/label'
import { Select, SelectContent, SelectItem, SelectTrigger } from '../../../../../_atoms/select'
import TableActions from '../../../../../_atoms/table-actions'
import { EtherCATStats } from '../../../../../_molecules/ethercat-stats'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../../../../_molecules/modal'
import { PluginStatsPanel } from '../../../../../_molecules/plugin-stats-panel'
import { ScanCycleStats } from '../../../../../_molecules/scan-cycle-stats'
import { DeviceEditorSlot } from '../../../../../_templates/[editors]/device-editor-slot'
import { PinMappingTable } from './components/pin-mapping-table'

const Board = memo(function () {
  const capabilities = useCapabilities()
  const device = useDevice()
  const runtime = useRuntime()

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

  // Whether this target exposes the GPIO pin-mapping table. Arduino boards
  // enable it via their preset; runtime-v4 GPIO boards (e.g. the Raspberry
  // Pi HAL) opt in with `capabilities.pinMapping` in their VPP manifest.
  const pinMappingEnabled = resolveTargetCapabilities(currentBoardInfo).pinMapping

  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress || '')
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const setRuntimeIpAddress = useOpenPLCStore((state) => state.deviceActions.setRuntimeIpAddress)
  const setRuntimeConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setRuntimeConnectionStatus)
  const setRuntimeJwtToken = useOpenPLCStore((state) => state.deviceActions.setRuntimeJwtToken)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const timingStats = useOpenPLCStore((state): TimingStats | null => state.runtimeConnection.timingStats)
  const setIncludeTimingStatsInPolling = useOpenPLCStore(
    (state): ((include: boolean) => void) => state.deviceActions.setIncludeTimingStatsInPolling,
  )
  const setIncludeEthercatStatsInPolling = useOpenPLCStore(
    (state): ((include: boolean) => void) => state.deviceActions.setIncludeEthercatStatsInPolling,
  )

  const [isPressed, setIsPressed] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [formattedBoardState, setFormattedBoardState] = useState('')
  const [showPythonWarning, setShowPythonWarning] = useState(false)
  // Human-readable label of the function-block kind(s) the target can't
  // host (e.g. "Python", "C/C++", "C/C++ and Python") — drives the
  // warning modal's copy so the same dialog serves Arduino (Python only)
  // and Runtime v3 (neither C/C++ nor Python).
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

  /**
   * Boards grouped by vendor.  VPP-installed boards come from
   * `info.vpp.vendor`; built-in OpenPLC targets (Simulator + Runtime
   * v3/v4) have no `vpp` field and bucket under "OpenPLC".  The
   * outer order keeps `OpenPLC` first (always-installed), followed
   * by VPP vendors alphabetically; boards within a group keep the
   * Map's insertion order (already sorted by `orderBoardsByVppGroup`
   * on the main side).
   *
   * Search filter applies case-insensitively against the board's
   * display name AND its vendor heading — typing "ardu" surfaces
   * every Arduino board even when the group heading is what the
   * user is targeting.  Empty groups are pruned so the dropdown
   * doesn't render a header with no children below it.
   */
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

    // When the checked item lives inside a vendor group, scroll the
    // whole group container into view so the heading above the item
    // stays on screen.  Without this, `block: 'start'` aligns the
    // item's top edge with the viewport's top, hiding the vendor
    // heading the item sits under.  Non-grouped selects (e.g. the
    // communication-port picker) keep the per-item scroll.
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

  // A target switch no longer needs to touch program variables: their
  // `location` holds a stable alias name (resolved at compile) or a literal
  // address — neither changes with the board. Producer address recompaction
  // for the new target is handled by `setDeviceBoard → recalculateIecAddresses`.

  useEffect(() => {
    scrollToSelectedOption(deviceSelectRef, deviceSelectIsOpen)
  }, [deviceSelectIsOpen])

  // Keep focus on the search input as the user types.  Radix Select
  // falls back to focusing the SelectContent listbox whenever the
  // currently-focused SelectItem unmounts — which happens every
  // time the user's typing filters the selected board out of the
  // visible list, pulling focus off the search input.  Refocus
  // through `queueMicrotask` (synchronously refocusing inside a
  // focusout handler is disallowed in some browsers; microtasks
  // run after the current task but before paint).  Gated on a
  // non-empty search term so the initial open still lets Radix
  // focus the currently-selected item — what the scroll-to-
  // selected effect keys off.
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
        // TODO: Add a toast notification for error and for success
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
        const { tabsActions, editorActions } = useOpenPLCStore.getState()
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

      // OpenPLC Runtime v3 can host neither C/C++ nor Python function
      // blocks: both lower to strucpp `{external ...}` inline-C that v3's
      // MatIEC toolchain can't compile.  Other targets are gated per
      // capability (Arduino: no Python; v4 / simulator: both fine).  Warn
      // on switch — same soft prompt Arduino shows for Python — and let
      // the user proceed (compilation will fail on the device if they do).
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

      // Warn when the new target can't host the servers or remote-device
      // I/O the project currently has configured.
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

  const handleConnectToRuntime = useCallback(async () => {
    if (connectionStatus === 'connected') {
      // Disconnect - global polling hook will handle resetting failure counter
      setRuntimeJwtToken(null)
      setRuntimeConnectionStatus('disconnected')
      await runtime.clearCredentials()
      return
    }

    if (!runtimeIpAddress) {
      return
    }

    setRuntimeConnectionStatus('connecting')

    try {
      const result = await runtime.getUsersInfo()

      if (result.error) {
        setRuntimeConnectionStatus('error')
        return
      }

      // Validate runtime version matches the selected board target
      const versionValidation = validateRuntimeVersion(deviceBoard, result.runtimeVersion)

      // Helper to proceed with connection after validation
      const proceedWithConnection = () => {
        if (result.hasUsers) {
          openModal('runtime-login', null)
        } else {
          openModal('runtime-create-user', null)
        }
      }

      if (versionValidation.status === 'mismatch') {
        // Hard error for version mismatch - cannot proceed
        setRuntimeConnectionStatus('error')
        openModal('debugger-message', {
          type: 'error',
          title: 'Runtime Version Mismatch',
          message: versionValidation.message || 'Unknown version mismatch error',
          buttons: ['OK'],
          onResponse: () => {
            // No action needed, just close the modal
          },
        })
        return
      }

      if (versionValidation.status === 'missing') {
        // Warning for older runtimes - allow user to continue anyway
        // Note: buttons ordered as ['Continue Anyway', 'Cancel'] so Cancel (index 1) is the default
        // when closing the modal (DebuggerMessageModal calls onResponse with last button index on close)
        openModal('debugger-message', {
          type: 'warning',
          title: 'Older Runtime Detected',
          message: versionValidation.message || 'Could not detect runtime version.',
          buttons: ['Continue Anyway', 'Cancel'],
          onResponse: (buttonIndex: number) => {
            if (buttonIndex === 0) {
              // User clicked "Continue Anyway" - proceed with connection
              proceedWithConnection()
            } else {
              // User clicked "Cancel" or closed the modal - stay disconnected
              setRuntimeConnectionStatus('disconnected')
            }
          },
        })
        return
      }

      // Version is OK - proceed normally
      proceedWithConnection()
    } catch (_error) {
      setRuntimeConnectionStatus('error')
    }
  }, [
    runtime,
    runtimeIpAddress,
    connectionStatus,
    setRuntimeConnectionStatus,
    setRuntimeJwtToken,
    openModal,
    deviceBoard,
  ])

  // Enable timing stats in global polling when this screen is visible
  useEffect(() => {
    // Set the flag to include timing stats in the global status polling
    setIncludeTimingStatsInPolling(true)

    // Clear the flag when leaving this screen
    return () => {
      setIncludeTimingStatsInPolling(false)
    }
  }, [setIncludeTimingStatsInPolling])

  // Only runtime targets expose the EtherCAT endpoint; skip the poll otherwise.
  useEffect(() => {
    if (!isOpenPLCRuntimeTarget(currentBoardInfo)) return
    setIncludeEthercatStatsInPolling(true)
    return () => {
      setIncludeEthercatStatsInPolling(false)
    }
  }, [setIncludeEthercatStatsInPolling, currentBoardInfo])

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
                // Reset the filter every time the dropdown closes so
                // reopening starts with the full list (and the
                // previously-selected item visible without scrolling).
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
                // Disable Radix's typeahead so it doesn't fight the
                // search box below for keystrokes — that fight was
                // surfacing as focus loss on the first character
                // that didn't match the currently-selected device.
                disableTypeahead
              >
                {/*
                  Search field — `sticky top-0` keeps it pinned while
                  the list scrolls.  Shares the rounded text-field
                  styling with the variable-type dropdown via the
                  shared `DropdownSearchInput` atom (which also stops
                  Radix Select's typeahead from intercepting
                  keystrokes).
                */}
                <DropdownSearchInput
                  ref={deviceSearchInputRef}
                  value={deviceSearchTerm}
                  onChange={(e) => setDeviceSearchTerm(e.target.value)}
                  aria-label='Search devices'
                />
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
                        return (
                          <SelectItem
                            key={board}
                            className={cn(
                              'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                              'flex w-full cursor-pointer items-center px-2 py-[7px] pl-5 outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                            )}
                            value={formattedBoard}
                          >
                            <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                              {formattedBoard}
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
              <div id='runtime-connect-button-container' className='flex w-full items-center justify-start'>
                <button
                  type='button'
                  onClick={handleConnectToRuntime}
                  disabled={connectionStatus === 'connecting'}
                  className='h-[30px] rounded-md bg-brand px-4 py-1 font-caption text-cp-sm font-medium text-white hover:bg-brand-medium-dark disabled:opacity-50'
                >
                  {connectionStatus === 'connecting'
                    ? 'Connecting...'
                    : connectionStatus === 'connected'
                      ? 'Disconnect'
                      : 'Connect'}
                </button>
                {connectionStatus === 'connected' && (
                  <div className='ml-2 flex items-center gap-2'>
                    <span className='text-xs text-green-600 dark:text-green-400'>● Connected</span>
                    {plcStatus && (
                      <span className='text-xs text-neutral-600 dark:text-neutral-400'>| PLC: {plcStatus}</span>
                    )}
                  </div>
                )}
                {connectionStatus === 'error' && (
                  <span className='ml-2 text-xs text-red-600 dark:text-red-400'>● Connection failed</span>
                )}
              </div>
            </>
          ) : capabilities.hasLocalSerialPorts ? (
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
                    const displayName = port.name?.trim() || port.address
                    return (
                      <SelectItem
                        key={port.address}
                        className={cn(
                          'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                          'flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                        )}
                        value={port.address}
                      >
                        <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                          {displayName}
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
      {(() => {
        // Only draw the divider when there's actually content below it.
        // Pin mapping renders for any non-simulator target that declares
        // the pinMapping capability (Arduino boards, and runtime-v4 GPIO
        // VPP boards like the Raspberry Pi). Runtime targets also render
        // stats once connected — the two can coexist (a Pi shows the pin
        // table always and the stats panels when connected).
        const isSim = isSimulatorTarget(currentBoardInfo)
        const isRuntime = isOpenPLCRuntimeTarget(currentBoardInfo)
        const showStats = isRuntime && connectionStatus === 'connected'
        const showPinMapping = !isSim && pinMappingEnabled
        const showDivider = showStats || showPinMapping
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
      {isOpenPLCRuntimeTarget(currentBoardInfo) && connectionStatus === 'connected' && (
        <div className='flex w-full flex-col gap-6'>
          {timingStats && <ScanCycleStats timingStats={timingStats} />}
          <EtherCATStats />
          <PluginStatsPanel pluginStats={timingStats?.plugin_stats} />
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
