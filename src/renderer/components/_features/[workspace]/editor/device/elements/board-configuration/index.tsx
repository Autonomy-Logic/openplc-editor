/* eslint-disable @typescript-eslint/no-misused-promises */
import { RefreshIcon } from '@root/renderer/assets/icons'
import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { useOpenPLCStore } from '@root/renderer/store'
import { useState } from 'react'

const BoardConfiguration = () => {
  const [isPressed, setIsPressed] = useState(false)
  const {
    deviceAvailableOptions: { availableBoards, availableCommunicationPorts },
    deviceDefinitions: {
      configuration: { deviceBoard, communicationPort },
    },
    deviceActions: { setDeviceBoard, setCommunicationPort, setAvailableOptions },
  } = useOpenPLCStore()

  const refreshCommunicationPorts = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      setIsPressed(true)
      const ports = await window.bridge.refreshCommunicationPorts()
      setAvailableOptions({ availableCommunicationPorts: ports })
    } catch (error) {
      // TODO: Add a toast notification for error and for success
      console.error(error)
    } finally {
      setTimeout(() => setIsPressed(false), 500)
    }
  }

  return (
    <div id='board-configuration-container' className='flex h-full w-1/2 flex-col gap-6'>
      <div id='board-figure-container' className='h-[55%]'></div>
      <div
        id='board-preferences-container'
        className='flex h-[45%] flex-col items-start justify-center gap-3 p-32 sm:p-16'
      >
        <div id='board-selection' className='flex items-center justify-center gap-1'>
          <SelectField
            label='Device'
            placeholder={deviceBoard}
            setSelectedOption={setDeviceBoard}
            options={Array.from(availableBoards.keys())}
            ariaLabel='Device selection'
            className={availableBoards.get(deviceBoard)?.isCoreInstalled ? '[&_span]:opacity-60' : ''}
          />
        </div>
        <div id='programming-port-selection' className='flex items-center justify-center gap-1'>
          <SelectField
            options={availableCommunicationPorts}
            setSelectedOption={setCommunicationPort}
            label='Programming Port'
            placeholder={communicationPort}
            width='188px'
            ariaLabel='Programming port selection'
          />
          <button type='button' onClick={refreshCommunicationPorts} className='group' aria-pressed={isPressed}>
            <RefreshIcon size='sm' className={isPressed ? 'spin-refresh' : ''} />
          </button>
        </div>
        <p className='text-start font-caption text-xs font-semibold text-neutral-850 dark:text-white'>Specs</p>
        <div id='board-specs-container' className='grid grid-cols-2 place-content-around gap-2 overflow-auto'>
          {Object.entries(availableBoards.get(deviceBoard)?.specs || {}).map(([spec, value]) => (
            <p className='text-start font-caption text-cp-sm font-semibold text-neutral-850 dark:text-white' key={spec}>
              {spec}: <span className='font-light text-neutral-600 dark:text-neutral-400'>{value}</span>
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}

export { BoardConfiguration }
