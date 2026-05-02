import { useEffect, useMemo } from 'react'

import { communicationSelectors } from '../../../../../../hooks/use-store-selectors'
import { useOpenPLCStore } from '../../../../../../store'
import { cn } from '../../../../../../utils/cn'
import { Checkbox } from '../../../../../_atoms/checkbox'
import { Label } from '../../../../../_atoms/label'
import { DeviceEditorSlot } from '../../../../../_templates/[editors]/device-editor-slot'
import { ModbusRTUComponent } from './components/modbus-rtu'
import { ModbusTCPComponent } from './components/modbus-tcp'

const isOpenPLCRuntimeTarget = (boardInfo: { compiler?: string } | undefined) => {
  return boardInfo?.compiler === 'openplc-compiler' || boardInfo?.compiler === 'openplc_runtime'
}

const isSimulatorTarget = (boardInfo: { compiler?: string } | undefined) => {
  return boardInfo?.compiler === 'simulator'
}

const Communication = () => {
  const {
    deviceDefinitions: {
      configuration: {
        deviceBoard,
        communicationConfiguration: { communicationPreferences },
      },
    },
    deviceAvailableOptions: { availableBoards },
  } = useOpenPLCStore()

  const currentBoardInfo = availableBoards.get(deviceBoard)
  const isRuntimeTarget = isOpenPLCRuntimeTarget(currentBoardInfo)
  const isSimulator = isSimulatorTarget(currentBoardInfo)

  const isRTUEnabled = communicationPreferences.enabledRTU
  const isTCPEnabled = communicationPreferences.enabledTCP

  const setCommunicationPreferences = communicationSelectors.useSetCommunicationPreferences()

  useEffect(() => {
    const updateModbusConfig = () => {
      if (isRuntimeTarget) {
        setCommunicationPreferences({ enableRTU: false })
        setCommunicationPreferences({ enableTCP: false })
      }
    }
    updateModbusConfig()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceBoard, isRuntimeTarget])

  const handleEnableModbusRTU = () => {
    setCommunicationPreferences({ enableRTU: !isRTUEnabled })
  }
  const memoizedIsModbusRTUEnabled = useMemo(() => isRTUEnabled ?? false, [isRTUEnabled])

  const handleEnableModbusTCP = () => {
    setCommunicationPreferences({ enableTCP: !isTCPEnabled })
  }
  const memoizedIsModbusTCPEnabled = useMemo(() => isTCPEnabled ?? false, [isTCPEnabled])

  if (isSimulator) {
    return (
      <DeviceEditorSlot heading='Communication'>
        <p className='text-xs text-neutral-600 dark:text-neutral-400'>
          Modbus RTU is automatically configured for the simulator.
        </p>
      </DeviceEditorSlot>
    )
  }

  return (
    <DeviceEditorSlot heading='Communication'>
      <div id='modbus-rtu-container' className='flex h-fit w-full flex-col gap-4'>
        <div
          id='enable-modbus-rtu'
          className={cn('flex select-none items-center gap-2', !isRTUEnabled && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-rtu-checkbox'
            className={isRTUEnabled ? 'border-brand' : 'border-neutral-300'}
            checked={isRTUEnabled}
            disabled={isRuntimeTarget}
            onCheckedChange={handleEnableModbusRTU}
          />
          <Label
            htmlFor='enable-modbus-rtu-checkbox'
            className='text-sm font-medium text-neutral-950 hover:cursor-pointer dark:text-white'
          >
            Enable Modbus RTU
          </Label>
        </div>
        <ModbusRTUComponent isModbusRTUEnabled={memoizedIsModbusRTUEnabled} />
      </div>
      <hr id='container-split' className='h-[1px] w-full self-stretch bg-brand-light' />
      <div id='modbus-tcp-container' className='flex h-full w-full flex-col gap-4'>
        <div
          id='enable-modbus-tcp'
          className={cn('flex select-none items-center gap-2', !isTCPEnabled && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-tcp-checkbox'
            className={isTCPEnabled ? 'border-brand' : 'border-neutral-300'}
            checked={isTCPEnabled}
            disabled={isRuntimeTarget}
            onCheckedChange={handleEnableModbusTCP}
          />
          <Label
            htmlFor='enable-modbus-tcp-checkbox'
            className='text-sm font-medium text-neutral-950 hover:cursor-pointer dark:text-white'
          >
            Enable Modbus TCP
          </Label>
        </div>
        <ModbusTCPComponent isModbusTCPEnabled={memoizedIsModbusTCPEnabled} />
      </div>
    </DeviceEditorSlot>
  )
}

export { Communication }
