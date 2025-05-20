import { Checkbox, Label } from '@root/renderer/components/_atoms'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useEffect, useMemo, useState } from 'react'

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

  const [isModbusRTUEnabled, setIsModbusRTUEnabled] = useState<boolean>()
  console.log('🚀 ~ Communication ~ isModbusRTUEnabled:', isModbusRTUEnabled)
  console.log('🚀 ~ Communication ~ isRTUEnabled:', isRTUEnabled)
  const [isModbusTCPEnabled, setIsModbusTCPEnabled] = useState<boolean>()
  console.log('🚀 ~ Communication ~ isModbusTCPEnabled:', isModbusTCPEnabled)
  console.log('🚀 ~ Communication ~ isTCPEnabled:', isTCPEnabled)

  useEffect(() => {
    setIsModbusRTUEnabled(isRTUEnabled)

    setIsModbusTCPEnabled(isTCPEnabled)
  }, [])

  useEffect(() => {
    const updateModbusConfig = () => {
      if (onlyCompileBoards.includes(deviceBoard)) {
        setIsModbusRTUEnabled(false)
        setCommunicationPreferences({ enableRTU: false })
        setIsModbusTCPEnabled(false)
        setCommunicationPreferences({ enableTCP: false })
      }
    }
    updateModbusConfig()
  }, [deviceBoard])

  const handleEnableModbusRTU = () => {
    setIsModbusRTUEnabled(!isModbusRTUEnabled)
    setCommunicationPreferences({ enableRTU: !isModbusRTUEnabled })
  }
  const memoizedIsModbusRTUEnabled = useMemo(() => isModbusRTUEnabled ?? false, [isModbusRTUEnabled])

  const handleEnableModbusTCP = () => {
    setIsModbusTCPEnabled(!isModbusTCPEnabled)
    setCommunicationPreferences({ enableTCP: !isModbusTCPEnabled })
  }
  const memoizedIsModbusTCPEnabled = useMemo(() => isModbusTCPEnabled ?? false, [isModbusTCPEnabled])

  return (
    <DeviceEditorSlot heading='Communication'>
      <div id='modbus-rtu-container' className='flex h-fit w-full flex-col gap-4'>
        <div
          id='enable-modbus-rtu'
          className={cn('flex select-none items-center gap-2', !isModbusRTUEnabled && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-rtu-checkbox'
            className={isModbusRTUEnabled ? 'border-brand' : 'border-neutral-300'}
            checked={isModbusRTUEnabled}
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
          className={cn('flex select-none items-center gap-2', !isModbusTCPEnabled && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-tcp-checkbox'
            className={isModbusTCPEnabled ? 'border-brand' : 'border-neutral-300'}
            checked={isModbusTCPEnabled}
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
