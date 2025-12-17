/* eslint-disable @typescript-eslint/no-misused-promises */
import { boardSelectors, compileOnlySelectors, pinSelectors } from '@hooks/use-store-selectors'
import { MinusIcon, PlusIcon, RefreshIcon } from '@root/renderer/assets'
import { Checkbox, Label, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import TableActions from '@root/renderer/components/_atoms/table-actions'
import { Modal, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '@root/renderer/components/_molecules/modal'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import type { DeviceActions, RuntimeConnection, TimingStats } from '@root/renderer/store/slices/device/types'
import { cn, isArduinoTarget, isOpenPLCRuntimeTarget, validateRuntimeVersion } from '@root/utils'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { PinMappingTable } from './components/pin-mapping-table'

const Board = memo(function () {
  // Auto-disconnect after 3 consecutive status poll failures (7.5 seconds)
  const MAX_CONSECUTIVE_FAILURES = 3

  const {
    deviceDefinitions: { compileOnly },
    deviceAvailableOptions: { availableBoards },
    project: {
      data: { pous },
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

  const setCompileOnly = compileOnlySelectors.useSetCompileOnly()

  const pins = pinSelectors.usePins()
  const createNewPin = pinSelectors.useCreateNewPin()
  const removePin = pinSelectors.useRemovePin()

  const currentBoardInfo = availableBoards.get(deviceBoard)

  const runtimeIpAddress = useOpenPLCStore((state) => state.deviceDefinitions.configuration.runtimeIpAddress || '')
  const connectionStatus = useOpenPLCStore((state) => state.runtimeConnection.connectionStatus)
  const setRuntimeIpAddress = useOpenPLCStore((state) => state.deviceActions.setRuntimeIpAddress)
  const setRuntimeConnectionStatus = useOpenPLCStore((state) => state.deviceActions.setRuntimeConnectionStatus)
  const setRuntimeJwtToken = useOpenPLCStore((state) => state.deviceActions.setRuntimeJwtToken)
  const openModal = useOpenPLCStore((state) => state.modalActions.openModal)
  const plcStatus = useOpenPLCStore((state): RuntimeConnection['plcStatus'] => state.runtimeConnection.plcStatus)
  const timingStats = useOpenPLCStore((state): TimingStats | null => state.runtimeConnection.timingStats)
  const setPlcRuntimeStatus = useOpenPLCStore(
    (state): DeviceActions['setPlcRuntimeStatus'] => state.deviceActions.setPlcRuntimeStatus,
  )
  const setTimingStats = useOpenPLCStore(
    (state): ((stats: TimingStats | null) => void) => state.deviceActions.setTimingStats,
  )

  const [isPressed, setIsPressed] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [formattedBoardState, setFormattedBoardState] = useState('')
  const [showPythonWarning, setShowPythonWarning] = useState(false)
  const [pendingBoardChange, setPendingBoardChange] = useState<{ board: string; formattedBoard: string } | null>(null)

  const [deviceSelectIsOpen, setDeviceSelectIsOpen] = useState(false)
  const deviceSelectRef = useRef<HTMLDivElement>(null)

  const [communicationSelectIsOpen, setCommunicationSelectIsOpen] = useState(false)
  const communicationSelectRef = useRef<HTMLDivElement>(null)
  const consecutiveFailuresRef = useRef<number>(0)
  const portsReqIdRef = useRef<number>(0)
  const [isRefreshingPorts, setIsRefreshingPorts] = useState(false)

  const scrollToSelectedOption = (selectRef: React.RefObject<HTMLDivElement>, selectIsOpen: boolean) => {
    if (!selectIsOpen) return

    const checkedElement = selectRef.current?.querySelector('[data-state="checked"]')
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }

  useEffect(() => {
    const handleDeviceValueAtFirstRender = () => {
      const boardInfos = availableBoards.get(deviceBoard)
      if (boardInfos) {
        const coreVersionAsString = `${boardInfos.coreVersion ? ` [${boardInfos.coreVersion}]` : ''}`
        const initialBoard = `${deviceBoard}${coreVersionAsString}`
        if (initialBoard === formattedBoardState) return
        setFormattedBoardState(initialBoard)
      }
    }
    handleDeviceValueAtFirstRender()
  }, [])

  useEffect(() => {
    scrollToSelectedOption(deviceSelectRef, deviceSelectIsOpen)
  }, [deviceSelectIsOpen])

  useEffect(() => {
    scrollToSelectedOption(communicationSelectRef, communicationSelectIsOpen)
  }, [communicationSelectIsOpen])

  useEffect(() => {
    const fetchPreviewImage = async () => {
      const boardInfos = availableBoards.get(deviceBoard)
      const imagePath = await window.bridge.getPreviewImage(boardInfos?.preview || 'generic.png')
      setPreviewImage(imagePath)
    }
    void fetchPreviewImage()
  }, [deviceBoard])

  const refreshCommunicationPorts = useCallback(
    async (e: React.MouseEvent) => {
      e.preventDefault()
      if (isRefreshingPorts) return

      try {
        setIsRefreshingPorts(true)
        setIsPressed(true)

        portsReqIdRef.current += 1
        const currentReqId = portsReqIdRef.current

        const ports = await window.bridge.refreshCommunicationPorts()

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
    [setAvailableOptions, isRefreshingPorts],
  )

  const handleSetDeviceBoard = useCallback(
    (board: string) => {
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
      const isArduino = isArduinoTarget(targetBoardInfo)
      const hasPythonFunctionBlocks = pous.some(
        (pou) => pou.type === 'function-block' && pou.data.language === 'python',
      )

      if (isArduino && hasPythonFunctionBlocks) {
        setPendingBoardChange({ board: normalizedBoard, formattedBoard: board })
        setShowPythonWarning(true)
        return
      }

      setFormattedBoardState(board)
      setDeviceBoard(normalizedBoard)
    },
    [connectionStatus, deviceBoard, setDeviceBoard, setFormattedBoardState, openModal, pous, availableBoards],
  )
  const handleRowClick = (row: HTMLTableRowElement) => setCurrentSelectedPinTableRow(parseInt(row.id))

  const handleCompileOnly = () => {
    setCompileOnly(!memoizedCompileOnly)
  }
  const memoizedCompileOnly = useMemo(() => compileOnly, [compileOnly])

  const handleConnectToRuntime = useCallback(async () => {
    if (connectionStatus === 'connected') {
      consecutiveFailuresRef.current = 0
      setRuntimeJwtToken(null)
      setRuntimeConnectionStatus('disconnected')
      const clearCreds = window.bridge.runtimeClearCredentials as (() => Promise<{ success: boolean }>) | undefined
      await clearCreds?.()
      return
    }

    if (!runtimeIpAddress) {
      return
    }

    setRuntimeConnectionStatus('connecting')

    try {
      const result = await window.bridge.runtimeGetUsersInfo(runtimeIpAddress)

      if (result.error) {
        setRuntimeConnectionStatus('error')
        return
      }

      // Validate runtime version matches the selected board target
      const versionValidation = validateRuntimeVersion(deviceBoard, result.runtimeVersion)
      if (!versionValidation.isValid) {
        setRuntimeConnectionStatus('error')
        openModal('debugger-message', {
          type: 'error',
          title: 'Runtime Version Mismatch',
          message: versionValidation.errorMessage || 'Unknown version mismatch error',
          buttons: ['OK'],
          onResponse: () => {
            // No action needed, just close the modal
          },
        })
        return
      }

      if (result.hasUsers) {
        openModal('runtime-login', null)
      } else {
        openModal('runtime-create-user', null)
      }
    } catch (_error) {
      setRuntimeConnectionStatus('error')
    }
  }, [runtimeIpAddress, connectionStatus, setRuntimeConnectionStatus, setRuntimeJwtToken, openModal, deviceBoard])

  useEffect(() => {
    let statusInterval: NodeJS.Timeout | null = null

    const pollStatus = async (): Promise<void> => {
      if (
        connectionStatus === 'connected' &&
        runtimeIpAddress &&
        useOpenPLCStore.getState().runtimeConnection.jwtToken
      ) {
        const handlePollFailure = () => {
          consecutiveFailuresRef.current += 1
          if (consecutiveFailuresRef.current >= MAX_CONSECUTIVE_FAILURES) {
            consecutiveFailuresRef.current = 0
            setRuntimeJwtToken(null)
            setRuntimeConnectionStatus('disconnected')
            setPlcRuntimeStatus(null)
            setTimingStats(null)
          } else {
            setPlcRuntimeStatus('UNKNOWN')
          }
        }

        try {
          const result = await window.bridge.runtimeGetStatus(
            runtimeIpAddress,
            useOpenPLCStore.getState().runtimeConnection.jwtToken!,
          )
          if (result.success && result.status) {
            consecutiveFailuresRef.current = 0
            const statusValue = result.status.replace('STATUS:', '').replace('\n', '').trim()
            const validStatuses = ['INIT', 'RUNNING', 'STOPPED', 'ERROR', 'EMPTY', 'UNKNOWN'] as const
            if (validStatuses.includes(statusValue as (typeof validStatuses)[number])) {
              setPlcRuntimeStatus(statusValue as (typeof validStatuses)[number])
            } else {
              setPlcRuntimeStatus('UNKNOWN')
            }
            // Update timing stats if available (OpenPLC Runtime v4+)
            if (result.timingStats) {
              setTimingStats(result.timingStats)
            } else {
              setTimingStats(null)
            }
          } else {
            handlePollFailure()
          }
        } catch (_error) {
          handlePollFailure()
        }
      }
    }

    if (connectionStatus === 'connected') {
      void pollStatus()
      statusInterval = setInterval(() => void pollStatus(), 2500)
    } else {
      setPlcRuntimeStatus(null)
      setTimingStats(null)
    }

    return () => {
      if (statusInterval) clearInterval(statusInterval)
    }
  }, [connectionStatus, runtimeIpAddress, setPlcRuntimeStatus])

  return (
    <DeviceEditorSlot heading='Board Settings'>
      <div id='compile-only-container' className='flex select-none items-center gap-2'>
        <Label htmlFor='compile-only-checkbox' className='w-fit text-xs text-neutral-950 dark:text-white'>
          Compile Only
        </Label>
        <Checkbox
          id='compile-only-checkbox'
          className={compileOnly ? 'h-[14px] w-[14px] border-brand' : 'h-[14px] w-[14px] border-neutral-300'}
          checked={compileOnly}
          onCheckedChange={handleCompileOnly}
        />
      </div>
      <div id='board-selection-container' className='flex h-2/5 min-h-[325px] w-full justify-between'>
        <div
          id='board-preferences-container'
          className='flex h-full w-1/2 max-w-[400px] flex-col items-start justify-start gap-3 overflow-hidden'
        >
          <div id='board-selector' className='flex w-full items-center justify-start gap-1 pr-5'>
            <Label id='device-selector-label' className='w-fit text-xs text-neutral-950 dark:text-white'>
              Device
            </Label>
            <Select
              value={formattedBoardState}
              onValueChange={handleSetDeviceBoard}
              onOpenChange={setDeviceSelectIsOpen}
            >
              <SelectTrigger
                aria-label='Device selection'
                placeholder={formattedBoardState}
                withIndicator
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none data-[state=open]:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent
                className='h-[250px] w-[--radix-select-trigger-width] overflow-y-auto rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                sideOffset={5}
                alignOffset={5}
                position='popper'
                align='center'
                side='bottom'
                viewportRef={deviceSelectRef}
              >
                {Array.from(availableBoards.entries()).map(([board, data]) => {
                  const formattedBoard = `${board}${data.coreVersion ? ` [${data.coreVersion}]` : ''}`
                  return (
                    <SelectItem
                      key={board}
                      className={cn(
                        'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                        'flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                      )}
                      value={formattedBoard}
                    >
                      <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                        {formattedBoard}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </div>
          {isOpenPLCRuntimeTarget(currentBoardInfo) ? (
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
                  className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none focus:border-brand-medium-dark dark:border-neutral-850 dark:bg-neutral-950 dark:text-neutral-300'
                />
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
          ) : (
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
          )}
          {!isOpenPLCRuntimeTarget(currentBoardInfo) && (
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
        <div id='board-preview-container' className='flex h-full w-1/2 items-center justify-center pb-8'>
          <div className='h-[16rem] w-[20rem]'>
            <img src={previewImage} alt='Device preview' className='h-full w-full object-contain' />
          </div>
        </div>
      </div>
      <hr id='container-split' className='h-[1px] w-full self-stretch bg-brand-light' />
      {isOpenPLCRuntimeTarget(currentBoardInfo) ? (
        connectionStatus === 'connected' &&
        timingStats &&
        timingStats.scan_count > 0 && (
          <div id='scan-cycle-stats-section' className='flex w-full flex-col gap-4'>
            <h2
              id='scan-cycle-stats-title'
              className='select-none text-lg font-medium text-neutral-950 dark:text-white'
            >
              Scan Cycle Statistics
            </h2>
            <div id='scan-cycle-stats-cards' className='grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4'>
              <div className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>Scan Count</span>
                <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
                  {timingStats.scan_count.toLocaleString()}
                </span>
              </div>
              <div className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                <span className='text-xs text-neutral-500 dark:text-neutral-400'>Overruns</span>
                <span className='text-lg font-semibold text-neutral-900 dark:text-white'>{timingStats.overruns}</span>
              </div>
              {timingStats.scan_time_avg !== null && (
                <div className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>Scan Time (avg)</span>
                  <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
                    {timingStats.scan_time_avg} <span className='text-sm font-normal'>us</span>
                  </span>
                  {timingStats.scan_time_min !== null && timingStats.scan_time_max !== null && (
                    <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                      min: {timingStats.scan_time_min} / max: {timingStats.scan_time_max}
                    </span>
                  )}
                </div>
              )}
              {timingStats.cycle_time_avg !== null && (
                <div className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>Cycle Time (avg)</span>
                  <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
                    {timingStats.cycle_time_avg} <span className='text-sm font-normal'>us</span>
                  </span>
                  {timingStats.cycle_time_min !== null && timingStats.cycle_time_max !== null && (
                    <span className='text-xs text-neutral-500 dark:text-neutral-400'>
                      min: {timingStats.cycle_time_min} / max: {timingStats.cycle_time_max}
                    </span>
                  )}
                </div>
              )}
              {timingStats.cycle_latency_avg !== null && (
                <div className='flex flex-col gap-1 rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-700 dark:bg-neutral-900'>
                  <span className='text-xs text-neutral-500 dark:text-neutral-400'>Cycle Latency (avg)</span>
                  <span className='text-lg font-semibold text-neutral-900 dark:text-white'>
                    {timingStats.cycle_latency_avg} <span className='text-sm font-normal'>us</span>
                  </span>
                </div>
              )}
            </div>
          </div>
        )
      ) : (
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
            <ModalTitle>Python Function Blocks Not Supported</ModalTitle>
          </ModalHeader>
          <div className='flex flex-col gap-4'>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              The selected target ({pendingBoardChange?.formattedBoard}) does not support Python Function Blocks.
            </p>
            <p className='text-sm text-neutral-700 dark:text-neutral-300'>
              Your project contains Python Function Blocks that will cause compilation to fail on this target. To use
              this target, you must remove all Python Function Blocks from your project.
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
    </DeviceEditorSlot>
  )
})

export { Board }
