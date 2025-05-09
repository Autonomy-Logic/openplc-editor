/* eslint-disable @typescript-eslint/no-misused-promises */
import { RefreshIcon } from '@root/renderer/assets'
import { Label, Select, SelectContent, SelectItem, SelectTrigger } from '@root/renderer/components/_atoms'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useCallback, useEffect, useRef, useState } from 'react'

const Board = () => {
  const [isPressed, setIsPressed] = useState(false)
  const [previewImage, setPreviewImage] = useState('')
  const [formattedBoardState, setFormattedBoardState] = useState('')
  const {
    deviceAvailableOptions: { availableBoards, availableCommunicationPorts },
    deviceDefinitions: {
      configuration: { deviceBoard, communicationPort },
    },
    deviceActions: { setDeviceBoard, setCommunicationPort, setAvailableOptions },
  } = useOpenPLCStore()

  const [deviceSelectIsOpen, setDeviceSelectIsOpen] = useState(false)
  const deviceSelectRef = useRef<HTMLDivElement>(null)

  const [communicationSelectIsOpen, setCommunicationSelectIsOpen] = useState(false)
  const communicationSelectRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const fetchPreviewImage = async () => {
      const imagePath = await window.bridge.getPreviewImage(availableBoards.get(deviceBoard)?.preview || '')
      setPreviewImage(imagePath)
    }
    void fetchPreviewImage()
  }, [deviceBoard])

  useEffect(() => {
    const selectIsOpen = deviceSelectIsOpen
    if (!selectIsOpen) return

    const checkedElement = deviceSelectRef.current?.querySelector('[data-state="checked"]')
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }, [deviceSelectIsOpen])

  useEffect(() => {
    const selectIsOpen = communicationSelectIsOpen
    if (!selectIsOpen) return

    const checkedElement = communicationSelectRef.current?.querySelector('[data-state="checked"]')
    if (checkedElement) {
      checkedElement.scrollIntoView({ block: 'start' })
    }
  }, [communicationSelectIsOpen])

  const refreshCommunicationPorts = useCallback(async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      setIsPressed(true)
      const ports = await window.bridge.refreshCommunicationPorts()
      setAvailableOptions({ availableCommunicationPorts: ports })
    } catch (error) {
      // TODO: Add a toast notification for error and for success
      console.error(error)
    } finally {
      setTimeout(() => setIsPressed(false), 400)
    }
  }, [])

  const handleSetDeviceBoard = useCallback(
    (board: string) => {
      setFormattedBoardState(board)
      const normalizedBoard = board.split('[')[0].trim()
      setDeviceBoard(normalizedBoard)
    },
    [setDeviceBoard],
  )

  return (
    <DeviceEditorSlot heading='Board Settings'>
      <div id='board-selection-container' className='flex h-2/5 min-h-[325px] w-full justify-between'>
        <div
          id='board-preferences-container'
          className='flex h-full w-1/2 max-w-[400px] flex-col items-start justify-start gap-3 overflow-hidden'
        >
          <div id='board-selector' className='flex w-full items-center justify-start gap-1 pr-5'>
            <Label id='device-selector-label' className='w-fit text-xs text-neutral-950 dark:text-white'>
              Device
            </Label>
            <Select value={formattedBoardState} onValueChange={handleSetDeviceBoard} onOpenChange={setDeviceSelectIsOpen}>
              <SelectTrigger
                aria-label='Device selection'
                placeholder='Select a board device'
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
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
          <div id='communication-ports-selector' className='flex w-full items-center justify-start gap-1'>
            <Label
              id='communication-ports-selector-label'
              className='whitespace-pre text-xs text-neutral-950 dark:text-white'
            >
              Communication Port
            </Label>
            <Select value={communicationPort} onValueChange={setCommunicationPort} onOpenChange={setCommunicationSelectIsOpen}>
              <SelectTrigger
                aria-label='Communication port selection'
                placeholder='Select a communication port'
                className='flex h-[30px] w-full items-center justify-between gap-1 rounded-md border border-neutral-100 bg-white px-2 py-1 font-caption text-cp-sm font-medium text-neutral-850 outline-none dark:border-brand-medium-dark dark:bg-neutral-950 dark:text-neutral-300'
              />
              <SelectContent
                className='h-[250px] w-[--radix-select-trigger-width] overflow-hidden rounded-lg border border-neutral-100 bg-white outline-none drop-shadow-lg dark:border-brand-medium-dark dark:bg-neutral-950'
                sideOffset={5}
                alignOffset={5}
                position='popper'
                align='center'
                side='bottom'
                viewportRef={communicationSelectRef}
              >
                {availableCommunicationPorts.map((port) => (
                  <SelectItem
                    key={port}
                    className={cn(
                      'data-[state=checked]:[&:not(:hover)]:bg-neutral-100 data-[state=checked]:dark:[&:not(:hover)]:bg-neutral-900',
                      'flex w-full cursor-pointer items-center px-2 py-[9px] outline-none hover:bg-neutral-200 dark:hover:bg-neutral-850',
                    )}
                    value={port}
                  >
                    <span className='flex items-center gap-2 font-caption text-cp-sm font-medium text-neutral-850 dark:text-neutral-300'>
                      {port}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <button type='button' onClick={refreshCommunicationPorts} className='group' aria-pressed={isPressed}>
              <RefreshIcon size='sm' className={isPressed ? 'spin-refresh' : ''} />
            </button>
          </div>
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
        </div>
        <div id='board-preview-container' className='flex h-full w-1/2 items-center justify-center pb-8'>
          <div className='h-[16rem] w-[20rem]'>
            <img src={previewImage} alt='Device preview' className='h-full w-full object-contain' />
          </div>
        </div>
      </div>
      <hr className='h-[1px] w-full self-stretch bg-brand-light' />
      <div id='pin-mapping-container' className=' h-3/5 w-full'>
        <p>Pin Mapping</p>
      </div>
    </DeviceEditorSlot>
  )
}

export { Board }
