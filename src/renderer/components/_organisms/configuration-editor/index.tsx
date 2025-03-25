import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { useState } from 'react'

import { deviceType } from './device'
import { CheckBox } from './elements/checkBox'
import { InputField } from './elements/input'
import { SelectField } from './elements/select'

const ConfigurationEditor = () => {
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })
  const [enableDHCP, setEnableDHCP] = useState(false)
  const [selectDevice, setSelectDevice] = useState(deviceType[0])
  const [selectedOption, setSelectedOption] = useState('Wi-Fi')
  const [selectBaudRateOption, setSelectBaudRateOption] = useState('115200')
  const [selectInterfaceOption, setSelectInterfaceOption] = useState('Serial')
  const [slaveId, setSlaveId] = useState('1')
  const [pin, setPin] = useState('-1')
  const [ipValue, setIpValue] = useState('192.168.1.195')
  const [gatewayValue, setGatewayValue] = useState('192.168.1.1')
  const [DNSValue, setDNSValue] = useState('8.8.8.8')
  const [subnetValue, setSubnetValue] = useState('255.255.255.0')
  const serialPortsOptions = ['/dev/ttyUSB0', 'Porta de comunicação (COM1) (COM1)']
  const [serialPort, setSerialPort] = useState(serialPortsOptions[0])

  const toggleModbus = (type: 'RTU' | 'TCP') => {
    setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] }))
  }

  return (
    <div className='flex h-full w-full select-none'>
      <DeviceConfiguration
        setSerialPort={setSerialPort}
        serialPort={serialPort}
        selectDevice={selectDevice}
        setSelectDevice={setSelectDevice}
        serialPortsOptions={serialPortsOptions}
      />

      <hr className='mx-4 h-[99%] w-[1px] self-stretch bg-brand-light pb-12' />

      <div className='flex h-full w-1/2 flex-col gap-6 overflow-auto px-8 py-3'>
        <span className='text-lg font-medium text-white'>Communication</span>

        <CheckBox
          id='modbus-rtu'
          label='Enable Modbus RTU (Serial)'
          checked={modbusConfig.RTU}
          onChange={() => toggleModbus('RTU')}
        />
        <RTUSettings
          slaveId={slaveId}
          setSlaveId={setSlaveId}
          pin={pin}
          setPin={setPin}
          enabled={modbusConfig.RTU}
          selectInterfaceOption={selectInterfaceOption}
          setSelectInterfaceOption={setSelectInterfaceOption}
          selectBaudRateOption={selectBaudRateOption}
          setSelectBaudRateOption={setSelectBaudRateOption}
        />

        <hr className='h-[1px] w-full self-stretch bg-brand-light' />

        <TCPSettings
          ipValue={ipValue}
          setIpValue={setIpValue}
          enableModbusTCP={modbusConfig.TCP}
          enableDHCP={enableDHCP}
          onToggle={() => toggleModbus('TCP')}
          setEnableDHCP={setEnableDHCP}
          selectedOption={selectedOption}
          setSelectedOption={setSelectedOption}
          gatewayValue={gatewayValue}
          setGatewayValue={setGatewayValue}
          DNSValue={DNSValue}
          setDNSValue={setDNSValue}
          subnetValue={subnetValue}
          setSubnetValue={setSubnetValue}
        />
      </div>
    </div>
  )
}

const DeviceConfiguration = ({
  selectDevice,
  setSelectDevice,
  serialPort,
  setSerialPort,
}: {
  selectDevice: string
  setSelectDevice: (value: string) => void
  serialPort: string
  setSerialPort: (value: string) => void
  serialPortsOptions: string[]
}) => {
  const {
    device: { availableBoards, availableCommunicationPorts },
  } = useOpenPLCStore()

  const formatBoardsForLabel = (boards: { board: string; version: string }[]) => {
    const formattedBoards = boards.map(({ board, version }) => `${board} (${version})`)
    return formattedBoards
  }

  return (
    <div className='flex h-full w-1/2 flex-col gap-6'>
      <div className='h-[60%]' />
      <div className='flex h-[40%] flex-col items-center justify-center'>
        <div className='flex flex-col gap-3'>
          <SelectField
            label='Device'
            placeholder={selectDevice}
            setSelectedOption={setSelectDevice}
            options={formatBoardsForLabel(availableBoards)}
            ariaLabel='Device select'
          />
          <SelectField
            options={availableCommunicationPorts}
            setSelectedOption={setSerialPort}
            label='Programming Port'
            placeholder={serialPort}
            width='188px'
            ariaLabel='Programming port select'
          />
          <DeviceSpecs />
        </div>
      </div>
    </div>
  )
}

const DeviceSpecs = () => (
  <div className='flex flex-col gap-1.5 text-xs font-medium text-neutral-850 dark:text-neutral-300'>
    <span className='text-neutral-950 dark:text-white'>Specs:</span>
    <span>CPU: ATmega328P @ 16MHz</span>
    <span>RAM: 2KB</span>
    <span>Flash: 32KB</span>
  </div>
)

const RTUSettings = ({
  enabled,
  setSelectBaudRateOption,
  selectBaudRateOption,
  setSelectInterfaceOption,
  selectInterfaceOption,
  slaveId,
  setSlaveId,
  pin,
  setPin,
}: {
  enabled: boolean
  setSelectBaudRateOption: (value: string) => void
  selectBaudRateOption: string
  setSelectInterfaceOption: (value: string) => void
  selectInterfaceOption: string
  slaveId: string
  setSlaveId: (value: string) => void
  pin: string
  setPin: (value: string) => void
}) => {
  const baudRateOptions = ['115200', '9600', '14400', '19200', '38400', '57600']
  const interfaceOptions = ['Serial', 'Serial1', 'Serial2', 'Serial3']

  return (
    <div className={cn('flex flex-col gap-4', { hidden: !enabled })}>
      <div className='flex gap-6'>
        <div className='flex flex-1 flex-col gap-4'>
          <SelectField
            setSelectedOption={setSelectInterfaceOption}
            selectedOption={selectInterfaceOption}
            options={interfaceOptions}
            label='Interface'
            placeholder='Select interface'
            ariaLabel='Interface select'
          />
          <InputField label='Slave ID' value={slaveId} onChange={setSlaveId} />
        </div>
        <div className='flex flex-1 flex-col gap-4'>
          <SelectField
            setSelectedOption={setSelectBaudRateOption}
            selectedOption={selectBaudRateOption}
            label='Baudrate'
            options={baudRateOptions}
          />
          <InputField label='RS485 TX Pin' value={pin} onChange={setPin} />
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
  selectedOption,
  setSelectedOption,
  ipValue,
  setIpValue,
  gatewayValue,
  setGatewayValue,
  DNSValue,
  setDNSValue,
  subnetValue,
  setSubnetValue,
}: {
  enableModbusTCP: boolean
  enableDHCP: boolean
  onToggle: () => void
  setEnableDHCP: (value: boolean) => void
  selectedOption: string
  setSelectedOption: (value: string) => void
  ipValue: string
  setIpValue: (value: string) => void
  gatewayValue: string
  setGatewayValue: (value: string) => void
  DNSValue: string
  setDNSValue: (value: string) => void
  subnetValue: string
  setSubnetValue: (value: string) => void
}) => {
  const interfaceOptions = ['Wi-Fi', 'Ethernet']
  const hiddenClass = !enableModbusTCP ? 'hidden' : ''
  const wifiHiddenClass = !enableModbusTCP || selectedOption === 'Ethernet' ? 'hidden' : ''
  const dhcpHiddenClass = enableDHCP ? 'hidden' : ''

  return (
    <div className='flex flex-col gap-5'>
      <CheckBox id='Enable Modbus TCP' label='Enable Modbus TCP' checked={enableModbusTCP} onChange={onToggle} />
      <SelectField
        options={interfaceOptions}
        selectedOption={selectedOption}
        setSelectedOption={setSelectedOption}
        className={hiddenClass}
        label='Interface'
        placeholder='Wi-Fi'
        ariaLabel='Interface select'
      />
      <InputField className={hiddenClass} label='MAC' value='0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD' />
      <div className='flex gap-6'>
        <InputField className={wifiHiddenClass} label='Wi-Fi SSID' />
        <InputField className={wifiHiddenClass} label='Password' />
      </div>
      <div className={`flex flex-col gap-5 ${hiddenClass}`}>
        <CheckBox
          id='Enable DHCP'
          label='Enable DHCP'
          checked={enableDHCP}
          onChange={() => setEnableDHCP(!enableDHCP)}
        />
        <div className='flex w-full justify-between gap-6'>
          <div className='flex w-full flex-col gap-4'>
            <InputField className={dhcpHiddenClass} label='IP' value={ipValue} onChange={setIpValue} />
            <InputField className={dhcpHiddenClass} label='Gateway' value={gatewayValue} onChange={setGatewayValue} />
          </div>
          <div className='flex w-full flex-col gap-4'>
            <InputField className={dhcpHiddenClass} label='DNS' value={DNSValue} onChange={setDNSValue} />
            <InputField className={dhcpHiddenClass} label='Subnet' value={subnetValue} onChange={setSubnetValue} />
          </div>
        </div>
      </div>
    </div>
  )
}

export { ConfigurationEditor }
