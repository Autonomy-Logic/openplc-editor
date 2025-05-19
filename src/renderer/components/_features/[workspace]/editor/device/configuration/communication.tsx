import { Checkbox, Label } from '@root/renderer/components/_atoms'
import { DeviceEditorSlot } from '@root/renderer/components/_templates/[editors]'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { memo, useEffect, useMemo, useState } from 'react'

import { ModbusRTUComponent } from './components/modbus-rtu'
import { ModbusTCPComponent } from './components/modbus-tcp'

const Communication = memo(function () {
  const onlyCompileBoards = ['OpenPLC Runtime', 'Raspberry Pi']
  const {
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
  } = useOpenPLCStore()
  const [enableRTU, setEnableRTU] = useState(false)
  const [enableTCP, setEnableTCP] = useState(false)

  useEffect(() => {
    const updateModbusConfig = () => {
      if (onlyCompileBoards.includes(deviceBoard)) {
        if (!enableRTU || !enableTCP) return
        setEnableRTU(false)
        setEnableTCP(false)
      }
    }
    updateModbusConfig()
  }, [deviceBoard])

  const handleEnableModbusRTU = () => setEnableRTU(!enableRTU)

  const handleEnableModbusTCP = () => setEnableTCP(!enableTCP)

  const memoizedRTUState = useMemo(() => enableRTU, [enableRTU])
  const memoizedTCPState = useMemo(() => enableTCP, [enableTCP])

  return (
    <DeviceEditorSlot heading='Communication'>
      <div id='modbus-rtu-container' className='flex h-fit w-full flex-col gap-4'>
        <div
          id='enable-modbus-rtu'
          className={cn('flex select-none items-center gap-2', !memoizedRTUState && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-rtu-checkbox'
            className={memoizedRTUState ? 'border-brand' : 'border-neutral-300'}
            checked={memoizedRTUState}
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
        <ModbusRTUComponent isModbusRTUEnabled={memoizedRTUState} />
      </div>
      <hr id='container-split' className='h-[1px] w-full self-stretch bg-brand-light' />
      <div id='modbus-tcp-container' className='flex h-full w-full flex-col gap-4'>
        <div
          id='enable-modbus-tcp'
          className={cn('flex select-none items-center gap-2', !memoizedTCPState && 'opacity-50')}
        >
          <Checkbox
            id='enable-modbus-tcp-checkbox'
            className={memoizedTCPState ? 'border-brand' : 'border-neutral-300'}
            checked={memoizedTCPState}
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
        <ModbusTCPComponent isModbusTCPEnabled={memoizedTCPState} />
      </div>
    </DeviceEditorSlot>
  )
})

export { Communication }
