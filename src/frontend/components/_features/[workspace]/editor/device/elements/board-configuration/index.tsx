import { RefreshIcon } from '@root/frontend/assets/icons/interface/Refresh'
import { useOpenPLCStore } from '@root/frontend/store'
import { useCallback, useMemo, useState } from 'react'

import { SelectField } from '../../../../../../_molecules/select-field'

const BoardConfiguration = () => {
  const [isPressed, setIsPressed] = useState(false)
  const {
    deviceAvailableOptions: { availableBoards, availableCommunicationPorts },
    deviceDefinitions: {
      configuration: { deviceBoard, communicationPort },
    },
    deviceActions: { setDeviceBoard, setCommunicationPort },
  } = useOpenPLCStore()

  const refreshCommunicationPorts = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      setIsPressed(true)
    } catch (error) {
      // TODO: Add a toast notification for error and for success
      console.error(error)
    } finally {
      setTimeout(() => setIsPressed(false), 500)
    }
  }

  const handleSetDeviceBoard = useCallback(
    (board: string) => {
      const normalizedBoard = board.split('[')[0].trim()
      setDeviceBoard(normalizedBoard)
    },
    [setDeviceBoard],
  )

  const deviceOptions = useMemo(
    () =>
      Array.from(availableBoards.entries()).map(([board, data]) => {
        const version = data.coreVersion
        return `${board}${version ? ` [${version}]` : ''}`
      }),
    [availableBoards],
  )

  return (
    <div id='board-configuration-container' className='flex h-full w-1/2 flex-col gap-6 overflow-hidden'>
      <div
        id='board-preferences-container'
        className='flex h-[70%] w-full flex-col items-start justify-center gap-3 overflow-y-auto overflow-x-hidden px-28 sm:px-16'
      >
        <div id='board-selection' className='flex items-center justify-center gap-1'>
          <SelectField
            label='Device'
            placeholder={deviceBoard}
            setSelectedOption={handleSetDeviceBoard}
            width='300px'
            options={deviceOptions}
            ariaLabel='Device selection'
          />
        </div>
        <div id='programming-port-selection' className='flex items-center justify-center gap-1'>
          <SelectField
            options={availableCommunicationPorts.map((p) => p.name)}
            setSelectedOption={setCommunicationPort}
            label='Programming Port'
            placeholder={communicationPort}
            className='[&_button]:w-[234px]'
            ariaLabel='Programming port selection'
          />
          <button type='button' onClick={refreshCommunicationPorts} className='group' aria-pressed={isPressed}>
            <RefreshIcon size='sm' className={isPressed ? 'spin-refresh' : ''} />
          </button>
        </div>
        <p className='text-start font-caption text-xs font-semibold text-neutral-850 dark:text-white '>Specs</p>
        <div id='board-specs-container' className='grid grid-cols-2 place-content-around gap-2'>
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
