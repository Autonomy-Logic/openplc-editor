import * as Checkbox from '@radix-ui/react-checkbox'
import { CheckIcon } from '@radix-ui/react-icons'
import { cn } from '@root/utils'
import { useState } from 'react'

import { InputWithRef, Select, SelectTrigger } from '../../_atoms'

const SelectField = ({
  label,
  placeholder,
  width,
  ariaLabel,
  className,
}: {
  label: string
  placeholder: string
  width?: string
  ariaLabel: string
  className?: string
}) => (
  <div className={`flex items-center gap-2.5 text-xs font-medium text-neutral-850 dark:text-neutral-300 ${className}`}>
    <label htmlFor={ariaLabel} className='text-neutral-950 dark:text-white'>
      {label}
    </label>
    <Select>
      <SelectTrigger
        aria-label={ariaLabel}
        withIndicator
        placeholder={placeholder}
        className={`h-7 min-w-0 ${width ? `w-[${width}]` : 'flex-1'} flex items-center justify-between  rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850  dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300`}
      />
    </Select>
  </div>
)

const InputField = ({ label, placeholder, className }: { label: string; placeholder?: string; className?: string }) => (
  <div className={`flex w-full items-center gap-2 ${className}`}>
    <span className='whitespace-nowrap text-sm font-medium text-neutral-950 dark:text-white'>{label}</span>
    <InputWithRef
      placeholder={placeholder}
      value=''
      className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand focus:outline-none dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
    />
  </div>
)

const ConfigurationEditor = () => {
  const [modbusConfig, setModbusConfig] = useState({
    RTU: false,
    TCP: {
      enableModbusTCP: false,
      enableDCHP: false,
    },
  })

  const toggleModbus = (type: 'RTU' | 'TCP') => {
    setModbusConfig((prev) => ({
      ...prev,
      [type]: !prev[type],
    }))
  }

  const toggleTCPOption = (option: 'enableModbusTCP' | 'enableDCHP') => {
    console.log(`Toggling ${option}`, 'modbusConfig', modbusConfig)
    setModbusConfig((prev) => ({
      ...prev,
      TCP: {
        ...prev.TCP,
        [option]: !prev.TCP[option],
      },
    }))
  }

  return (
    <div className='flex h-full w-full select-none'>
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
            <div className='flex flex-col gap-1.5 text-xs font-medium text-neutral-850 dark:text-neutral-300'>
              <span className='text-neutral-950 dark:text-white'>Specs:</span>
              <span>CPU: ATmega328P @ 16MHz</span>
              <span>RAM: 2KB</span>
              <span>Flash: 32kb</span>
            </div>
          </div>
        </div>
      </div>

      <hr className='mx-4 h-[99%] w-[1px] self-stretch bg-brand-light pb-12' />

      <div className='flex h-full w-1/2 flex-col gap-6 overflow-auto px-8 py-3'>
        <span className='text-lg font-medium text-white'>Communication</span>

        <ModbusCheckbox
          id='Enable Modbus RTU (Serial)'
          label='Enable Modbus RTU (Serial)'
          checked={modbusConfig.RTU}
          onChange={() => toggleModbus('RTU')}
        />
        <ModbusSettings enabled={modbusConfig.RTU} />

        <hr className='h-[1px] w-full self-stretch bg-brand-light' />

        <TCPSettings
          enableDCHP={modbusConfig.TCP.enableDCHP}
          enableModbusTCP={modbusConfig.TCP.enableModbusTCP}
          onToggle={toggleTCPOption}
        />
      </div>
    </div>
  )
}

const ModbusCheckbox = ({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: () => void
}) => (
  <div className='flex items-center gap-2'>
    <Checkbox.Root
      className={cn(
        'flex h-4 w-4 appearance-none items-center justify-center rounded-[4px] border bg-white outline-none dark:border-neutral-850',
        checked ? 'border-brand' : 'border-neutral-300',
      )}
      id={id}
      checked={checked}
      onCheckedChange={onChange}
    >
      <Checkbox.Indicator>
        <CheckIcon className='stroke-brand' />
      </Checkbox.Indicator>
    </Checkbox.Root>
    <label htmlFor={label} className='text-sm font-medium text-neutral-950 dark:text-white'>
      {label}
    </label>
  </div>
)

const ModbusSettings = ({ enabled }: { enabled: boolean }) => (
  <div className={cn('flex flex-col gap-4', { 'pointer-events-none opacity-50': !enabled })}>
    <div className='flex justify-between'>
      <div className='flex flex-col gap-4'>
        <SelectField label='Interface' placeholder='40028922' ariaLabel='Interface select' />
        <SelectField label='Slave ID:' placeholder='40028922' ariaLabel='Slave ID select' />
      </div>
      <div className='flex flex-col gap-4'>
        <SelectField label='Baudrate ' placeholder='40028922' ariaLabel='baudrate select' />
        <InputField label='RS485 TX Pin:' placeholder='40028922' />
      </div>
    </div>
  </div>
)

const TCPSettings = ({
  enableModbusTCP,
  enableDHCP,
  onToggle,
}: {
  enableModbusTCP: boolean
  enableDHCP: boolean
  onToggle: () => void
  label: string
}) => {
  const disabledStyle = 'hidden'
  return (
    <div className=''>
      <div className={cn('flex flex-col gap-5')}>
        <ModbusCheckbox
          id='Enable Modbus TCP'
          label='Enable Modbus TCP'
          checked={enableDHCP}
          onChange={() => onToggle('enableModbusTCP')}
        />
        <SelectField
          className={`${!enableModbusTCP ? disabledStyle : ''}`}
          label='Interface'
          placeholder='Wifi'
          ariaLabel='Wifi select'
        />
        <InputField
          className={`${!enableModbusTCP ? disabledStyle : ''}`}
          label='MAC'
          placeholder='0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD'
        />
        <div className='flex gap-6'>
          <InputField className={`${!enableModbusTCP ? disabledStyle : ''}`} label='Password' />
          <InputField className={`${!enableModbusTCP ? disabledStyle : ''}`} label='Wifi SSID' />
        </div>
        <ModbusCheckbox
          id='Enable DHCP'
          label='Enable DHCP'
          checked={enableDHCP}
          onChange={() => onToggle('enableDHCP')}
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
  )
}

export { ConfigurationEditor }
