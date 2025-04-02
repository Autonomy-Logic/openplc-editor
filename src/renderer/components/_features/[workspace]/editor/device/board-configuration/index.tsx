/* eslint-disable @typescript-eslint/no-misused-promises */
import { RefreshIcon } from '@root/renderer/assets/icons'
import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { useOpenPLCStore } from '@root/renderer/store'

const BoardConfiguration = () => {
  const {
    deviceAvailableOptions: { availableBoards, availableCommunicationPorts },
    deviceDefinitions: {
      configuration: { deviceBoard, communicationPort },
    },
    deviceActions: { setDeviceBoard, setCommunicationPort, setAvailableOptions },
  } = useOpenPLCStore()

  const formatBoardsForLabel = (boards: { board: string; version: string }[]) => {
    const formattedBoards = boards.map(({ board, version }) => `${board} ${version !== '0' && `[ ${version} ]`}`)
    return formattedBoards
  }

  const refreshCommunicationPorts = async (e: React.MouseEvent) => {
    e.preventDefault()
    const ports = await window.bridge.refreshCommunicationPorts()
    setAvailableOptions({ availableCommunicationPorts: ports.map(({ port }) => port) })
  }

  const refreshAvailableOptions = async (e: React.MouseEvent) => {
    e.preventDefault()
    const boards = await window.bridge.refreshAvailableBoards()
    setAvailableOptions({ availableBoards: boards })
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
          <button type='button' onClick={refreshAvailableOptions}>
            <RefreshIcon size='sm' />
          </button>
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
          <button type='button' onClick={refreshCommunicationPorts}>
            <RefreshIcon size='sm' />
          </button>
        </div>
        <div id='board-specs'>Here goes the specs</div>
      </div>
    </div>
  )
}

export { BoardConfiguration }
