import { Checkbox, Label } from '@root/renderer/components/_atoms'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useCallback, useEffect, useState } from 'react'

const Communication = () => {
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })
  const onlyCompileBoards = ['OpenPLC Runtime', 'Raspberry Pi']
  const {
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
  } = useOpenPLCStore()

  useEffect(() => {
    const updateModbusConfig = () => {
      if (onlyCompileBoards.includes(deviceBoard)) {
        setModbusConfig({ RTU: false, TCP: false })
      }
    }
    updateModbusConfig()
  }, [deviceBoard])
  const toggleModbus = useCallback(
    (type: 'RTU' | 'TCP') => setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] })),
    [],
  )

  const handleEnableModbusRTU = () => toggleModbus('RTU')

  const handleEnableModbusTCP = () => toggleModbus('TCP')
  return (
    <DeviceEditorSlot heading='Communication'>
      <div id='modbus-rtu-container' className='flex h-1/2 w-full flex-col gap-4'>
        <div
          id='enable-modbus-rtu'
          className={cn('flex select-none items-center gap-2', !modbusConfig.RTU && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-rtu-checkbox'
            className={modbusConfig.RTU ? 'border-brand' : 'border-neutral-300'}
            checked={modbusConfig.RTU}
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
      </div>
      <hr id='container-split' className='h-[1px] w-full self-stretch bg-brand-light' />
      <div id='modbus-tcp-container' className='flex h-1/2 w-full flex-col gap-4'>
        <div
          id='enable-modbus-tcp'
          className={cn('flex select-none items-center gap-2', !modbusConfig.TCP && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-tcp-checkbox'
            className={modbusConfig.TCP ? 'border-brand' : 'border-neutral-300'}
            checked={modbusConfig.TCP}
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
      </div>
    </DeviceEditorSlot>
  )
}

export { Communication }
