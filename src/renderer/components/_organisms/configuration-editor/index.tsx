import { cn } from '@root/utils'
import { useState } from 'react'

import { CheckBox } from './elements/checkBox'
import { InputField } from './elements/input'
import { SelectField } from './elements/select'

const ConfigurationEditor = () => {
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })
  const [enableDHCP, setEnableDHCP] = useState(false)
  const [selectedOption, setSelectedOption] = useState('wifi')

  const [selectBautradeOption, setSelectBautradeOption] = useState('115200')

  const toggleModbus = (type: 'RTU' | 'TCP') => {
    setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  return (
    <div className='flex h-full w-full select-none'>
      <DeviceConfiguration />

      <hr className='mx-4 h-[99%] w-[1px] self-stretch bg-brand-light pb-12' />

      <div className='flex h-full w-1/2 flex-col gap-6 overflow-auto px-8 py-3'>
        <span className='text-lg font-medium text-white'>Communication</span>

        <CheckBox
          id='modbus-rtu'
          label='Enable Modbus RTU (Serial)'
          checked={modbusConfig.RTU}
          onChange={() => toggleModbus('RTU')}
        />
        <ModbusSettings
          setSelectBautradeOption={setSelectBautradeOption}
          selectBautradeOption={selectBautradeOption}
          enabled={modbusConfig.RTU}
        />

        <hr className='h-[1px] w-full self-stretch bg-brand-light' />

        <TCPSettings
          {...{
            enableDHCP,
            setEnableDHCP,
            selectedOption,
            setSelectedOption,
            enableModbusTCP: modbusConfig.TCP,
            onToggle: () => toggleModbus('TCP'),
          }}
        />
      </div>
    </div>
  )
}

const DeviceConfiguration = () => (
  <div className='flex h-full w-1/2 flex-col gap-6'>
    <div className='h-[60%]' />
    <div className='flex h-[40%] flex-col items-center justify-center'>
      <div className='flex flex-col gap-3'>
        <SelectField label='Device' placeholder='arduino' ariaLabel='Device select' />
        <SelectField
          label='Programming Port'
          placeholder='40028922'
          width='188px'
          ariaLabel='Programming port select'
        />
        <DeviceSpecs />
      </div>
    </div>
  </div>
)

const DeviceSpecs = () => (
  <div className='flex flex-col gap-1.5 text-xs font-medium text-neutral-850 dark:text-neutral-300'>
    <span className='text-neutral-950 dark:text-white'>Specs:</span>
    <span>CPU: ATmega328P @ 16MHz</span>
    <span>RAM: 2KB</span>
    <span>Flash: 32kb</span>
  </div>
)

const ModbusSettings = ({
  enabled,
  setSelectBautradeOption,
  selectBautradeOption,
}: {
  enabled: boolean
  setSelectBautradeOption: (value: string) => void
  selectBautradeOption: string
}) => {
  const bautradeOptions = ['115200', '9600', '14400', '19200', '38400', '57600']
  return (
    <div className={cn('flex flex-col gap-4', { hidden: !enabled })}>
      <div className='flex justify-between'>
        <div className='flex flex-col gap-4'>
          <SelectField label='Interface' placeholder='Select interface' ariaLabel='Interface select' />
          <SelectField label='Slave ID' placeholder='Enter ID' ariaLabel='Slave ID select' />
        </div>
        <div className='flex flex-col gap-4'>
          <SelectField
            setSelectedOption={setSelectBautradeOption}
            selectedOption={selectBautradeOption}
            label='Baudrate'
            options={bautradeOptions}
          />
          <InputField label='RS485 TX Pin' placeholder='Enter pin' />
        </div>
      </div>
    </div>
  )
}

const TCPSettings = ({
  enableModbusTCP,
  enableDHCP,
  onToggle,
  setEnableDHCP,
  setSelectedOption,
  selectedOption,
}: {
  enableModbusTCP: boolean
  enableDHCP: boolean
  onToggle: () => void
  setEnableDHCP: (value: boolean) => void
  setSelectedOption: (value: string) => void
  selectedOption: string
}) => {
  const disabledStyle = 'hidden'
  const options = ['wifi', 'ethernet']
  return (
    <div className=''>
      <div className={cn('flex flex-col gap-5')}>
        <CheckBox
          id='Enable Modbus TCP'
          label='Enable Modbus TCP'
          checked={enableModbusTCP}
          onChange={() => onToggle()}
        />
        <SelectField
          options={options}
          selectedOption={selectedOption}
          setSelectedOption={setSelectedOption}
          className={`${!enableModbusTCP ? disabledStyle : ''}`}
          label='Interface'
          placeholder='Wifi'
          ariaLabel='Wifi select'
        />
        <InputField
          className={`${!enableModbusTCP ? disabledStyle : ''}`}
          label='MAC'
          value='0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD'
        />
        <div className='flex gap-6'>
          <InputField
            className={`${!enableModbusTCP || selectedOption === 'ethernet' ? disabledStyle : ''}`}
            label='Wifi SSID'
          />
          <InputField
            className={`${!enableModbusTCP || selectedOption === 'ethernet' ? disabledStyle : ''}`}
            label='Password'
          />
        </div>
        <div className={`${!enableModbusTCP ? disabledStyle : ''} flex flex-col gap-5`}>
          <CheckBox
            id='Enable DHCP'
            label='Enable DHCP'
            checked={enableDHCP}
            onChange={() => setEnableDHCP(!enableDHCP)}
          />
          <div className='flex w-full justify-between gap-6'>
            <div className='flex w-full flex-col gap-4'>
              <InputField className={`${enableDHCP ? disabledStyle : ''}`} label='IP' />
              <InputField className={`${enableDHCP ? disabledStyle : ''}`} label='Gateway' />
            </div>
            <div className='flex w-full flex-col gap-4'>
              <InputField className={`${enableDHCP ? disabledStyle : ''}`} label='DNS' />
              <InputField className={`${enableDHCP ? disabledStyle : ''}`} label='Subnet' />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export { ConfigurationEditor }
