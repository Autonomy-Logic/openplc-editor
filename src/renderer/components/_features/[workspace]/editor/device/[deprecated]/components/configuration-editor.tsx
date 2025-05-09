import { Checkbox } from '@root/renderer/components/_atoms'
import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

import { BoardConfiguration } from '../board-configuration'
import { RTUSettings } from '../rtu-settings'
import { TCPSettings } from '../tcp-settings'

const ConfigurationEditor = () => {
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })
  const onlyCompileBoards = [
    'OpenPLC Runtime',
    'Raspberry Pi',
    'Raspberry Pi 2',
    'Raspberry Pi 3',
    'Raspberry Pi 4',
    'Raspberry Pi 5',
  ]
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

  const toggleModbus = (type: 'RTU' | 'TCP') => setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] }))

  const handleEnableModbusRTU = () => toggleModbus('RTU')

  const handleEnableModbusTCP = () => toggleModbus('TCP')

  return (
    <div aria-label='configuration-editor container' className='flex h-full w-full select-none overflow-x-auto'>
      <BoardConfiguration />
      <hr className='mx-4 h-[99%] w-[1px] self-stretch bg-brand-light pb-12' />
      <div className='flex h-full w-1/2 flex-col gap-6 overflow-auto px-8 py-3'>
        <span className='text-lg font-medium text-white'>Communication</span>

        {/** TODO: disable user selection to not be permitted enable option */}
        <Checkbox
          id='modbus-rtu'
          label='Enable Modbus RTU (Serial)'
          checked={modbusConfig.RTU}
          onCheckedChange={handleEnableModbusRTU}
          disabled={onlyCompileBoards.includes(deviceBoard)}
        />
        <RTUSettings userEnabled={modbusConfig.RTU} />

        <hr className='h-[1px] w-full self-stretch bg-brand-light' />

        <Checkbox
          id='modbus-tcp'
          label='Enable Modbus TCP'
          checked={modbusConfig.TCP}
          onCheckedChange={handleEnableModbusTCP}
          disabled={onlyCompileBoards.includes(deviceBoard)}
        />
        {/** TODO: disable user selection to not be permitted enable option */}
        <TCPSettings userEnabled={modbusConfig.TCP} />
      </div>
    </div>
  )
}

export { ConfigurationEditor }
