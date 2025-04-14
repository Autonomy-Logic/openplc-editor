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

  const formatBoardsForLabel = (boards: { board: string; version: string }[]) => {
    return boards.map(({ board, version }) => `${board}${version !== '0' ? ` [ ${version} ]` : ''}`)
  }

  const refreshCommunicationPorts = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      setIsPressed(true)
      const ports = await window.bridge.refreshCommunicationPorts()
      setAvailableOptions({ availableCommunicationPorts: ports.map(({ port }) => port) })
    } catch (error) {
      // TODO: Add a toast notification for error and for success
      console.error(error)
    } finally {
      setTimeout(() => setIsPressed(false), 500)
    }
  }

  return (
    <div id='board-configuration-container' className='flex h-full w-1/2 flex-col gap-6'>
      <div id='board-figure-container' className='h-[60%]'></div>
      <div id='board-specs-container' className='flex h-[40%]  flex-col items-start justify-center gap-3 p-32 sm:p-16'>
        <div id='board-selection' className='flex items-center justify-center gap-1'>
          <SelectField
            label='Device'
            placeholder={deviceBoard}
            setSelectedOption={setDeviceBoard}
            options={formatBoardsForLabel(availableBoards)}
            ariaLabel='Device selection'
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
        <div id='board-specs'>Here goes the specs</div>
      </div>
    </div>
  )
}

export { BoardConfiguration }
