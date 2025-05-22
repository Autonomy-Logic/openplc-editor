import { Checkbox, Label } from '@root/renderer/components/_atoms'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useEffect, useMemo } from 'react'

import { communicationSelectors } from '../useStoreSelectors'
import { ModbusRTUComponent } from './components/modbus-rtu'
import { ModbusTCPComponent } from './components/modbus-tcp'

const Communication = () => {
  const onlyCompileBoards = ['OpenPLC Runtime', 'Raspberry Pi']
  const {
    deviceDefinitions: {
      configuration: {
        deviceBoard,
        communicationConfiguration: { communicationPreferences },
      },
    },
  } = useOpenPLCStore()

  const isRTUEnabled = communicationPreferences.enabledRTU
  const isTCPEnabled = communicationPreferences.enabledTCP

  const setCommunicationPreferences = communicationSelectors.useSetCommunicationPreferences()

  useEffect(() => {
    const updateModbusConfig = () => {
      if (onlyCompileBoards.includes(deviceBoard)) {
        setCommunicationPreferences({ enableRTU: false })
        setCommunicationPreferences({ enableTCP: false })
      }
    }
    updateModbusConfig()
  }, [deviceBoard])

  const handleEnableModbusRTU = () => {
    setCommunicationPreferences({ enableRTU: !isRTUEnabled })
  }
  const memoizedIsModbusRTUEnabled = useMemo(() => isRTUEnabled ?? false, [isRTUEnabled])

  const handleEnableModbusTCP = () => {
    setCommunicationPreferences({ enableTCP: !isTCPEnabled })
  }
  const memoizedIsModbusTCPEnabled = useMemo(() => isTCPEnabled ?? false, [isTCPEnabled])

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
            disabled={onlyCompileBoards.includes(deviceBoard)}
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
            disabled={onlyCompileBoards.includes(deviceBoard)}
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
