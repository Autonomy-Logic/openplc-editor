import { useOpenPLCStore } from '@root/renderer/store'
import { useEffect, useState } from 'react'

import { Checkbox } from '../../_atoms'
import { BoardConfiguration } from '../../_features/[workspace]/editor/device/board-configuration'
import { RTUSettings } from '../../_features/[workspace]/editor/device/rtu-settings'
import { CheckBox } from './elements/checkBox'
import { InputField } from './elements/input'
import { SelectField } from './elements/select'

const ConfigurationEditor = () => {
  const [modbusConfig, setModbusConfig] = useState({ RTU: false, TCP: false })
  const [enableDHCP, setEnableDHCP] = useState(false)
  const [selectedOption, setSelectedOption] = useState('Wi-Fi')
  const [ipValue, setIpValue] = useState('192.168.1.195')
  const [gatewayValue, setGatewayValue] = useState('192.168.1.1')
  const [DNSValue, setDNSValue] = useState('8.8.8.8')
  const [subnetValue, setSubnetValue] = useState('255.255.255.0')

  const {
    deviceDefinitions: {
      configuration: { deviceBoard },
    },
  } = useOpenPLCStore()

  const toggleModbus = (type: 'RTU' | 'TCP') => setModbusConfig((prev) => ({ ...prev, [type]: !prev[type] }))

  useEffect(() => {
    const updateModbusConfig = () => {
      if (deviceBoard === 'OpenPLC Runtime [ default ]') {
        setModbusConfig({ RTU: false, TCP: false })
      }
    }

    updateModbusConfig()
  }, [deviceBoard])

  return (
    <div className='flex h-full w-full select-none'>
      <BoardConfiguration />

      <hr className='mx-4 h-[99%] w-[1px] self-stretch bg-brand-light pb-12' />

      <div className='flex h-full w-1/2 flex-col gap-6 overflow-auto px-8 py-3'>
        <span className='text-lg font-medium text-white'>Communication</span>

        {/** TODO: disable user selection to not be permitted enable option */}
        <Checkbox
          id='modbus-rtu'
          label='Enable Modbus RTU (Serial)'
          checked={modbusConfig.RTU}
          onCheckedChange={() => toggleModbus('RTU')}
          disabled={deviceBoard === 'OpenPLC Runtime [ default ]'}
        />
        <RTUSettings userEnabled={modbusConfig.RTU} />

        <hr className='h-[1px] w-full self-stretch bg-brand-light' />

        <Checkbox
          id='modbus-tcp'
          label='Enable Modbus TCP'
          checked={modbusConfig.TCP}
          onCheckedChange={() => toggleModbus('TCP')}
          disabled={true}
        />
        {/** TODO: disable user selection to not be permitted enable option; refactor component */}
        <TCPSettings
          ipValue={ipValue}
          setIpValue={setIpValue}
          enableModbusTCP={modbusConfig.TCP || deviceBoard !== 'OpenPLC Runtime [ default ]'}
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
