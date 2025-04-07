import { Checkbox } from '@root/renderer/components/_atoms'
import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { InputField } from '@root/renderer/components/_organisms/configuration-editor/elements/input'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, useState } from 'react'

type TCPSettingsProps = ComponentPropsWithoutRef<'div'> & {
  userEnabled: boolean
}

const TCPSettings = ({ userEnabled, ...props }: TCPSettingsProps) => {
  const [interfaceOption, setInterfaceOption] = useState<string>('Wi-Fi')
  const [enableDHCP, setEnableDHCP] = useState(false)

  const handleInterfaceOptionChange = (value: string) => setInterfaceOption(value)

  const handleEnableDHCPChange = () => setEnableDHCP(!enableDHCP)

  return (
    <div
      aria-label='Modbus TCP settings form container'
      className={cn('flex flex-col gap-5', !userEnabled && 'hidden')}
      {...props}
    >
      <SelectField
        ariaLabel='Interface select'
        label='Interface'
        options={['Wi-Fi', 'Ethernet']}
        placeholder='Select interface'
        selectedOption={interfaceOption}
        setSelectedOption={handleInterfaceOptionChange}
      />
      <InputField label='MAC' value='0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD' />
      {interfaceOption === 'Wi-Fi' && (
        <div aria-label='Wi-Fi settings form container' className='flex gap-5'>
          <InputField label='Wi-Fi SSID' />
          <InputField label='Password' />
        </div>
      )}
      <div aria-label='DHCP settings container' className='flex flex-col gap-5'>
        <Checkbox id='enable-dhcp' label='Enable DHCP' checked={enableDHCP} onCheckedChange={handleEnableDHCPChange} />
        {!enableDHCP && (
          <div className='flex w-full justify-between gap-6'>
            <div className='flex w-full flex-col gap-4'>
              <InputField label='IP' value='192.168.1.195' />
              <InputField label='Gateway' value='192.168.1.1' />
            </div>
            <div className='flex w-full flex-col gap-4'>
              <InputField label='DNS' value='8.8.8.8' />
              <InputField label='Subnet' value='255.255.255.0' />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export { TCPSettings }
