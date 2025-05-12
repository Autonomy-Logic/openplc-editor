import { Checkbox } from '@root/renderer/components/_atoms'
import { InputField } from '@root/renderer/components/_molecules/input-field'
import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef, useState } from 'react'

type RTUSettingsProps = ComponentPropsWithoutRef<'div'> & {
  userEnabled?: boolean
}

const RTUSettings = ({ userEnabled, ...props }: RTUSettingsProps) => {
  const {
    deviceAvailableOptions: { availableRTUInterfaces, availableRTUBaudRates },
    deviceDefinitions: {
      configuration: {
        communicationConfiguration: {
          modbusRTU: { rtuInterface, rtuBaudRate },
        },
      },
    },
  } = useOpenPLCStore()
  const [enableTS485ENPin, setEnableTS485ENPin] = useState(false)

  const handleEnableTS485ENPin = () => setEnableTS485ENPin(!enableTS485ENPin)

  return (
    <div
      aria-label='Modbus RTU settings form container'
      className={cn('flex gap-6', !userEnabled && 'hidden')}
      {...props}
    >
      <div className='flex flex-1 flex-col gap-4'>
        <SelectField
          ariaLabel='RTU Interface select'
          label='Interface'
          // setSelectedOption={setSelectInterfaceOption}
          selectedOption={rtuInterface}
          options={availableRTUInterfaces}
          placeholder='Select interface'
        />
        <InputField
          label='Slave ID'
          // value={slaveId} onChange={setSlaveId}
        />
      </div>
      <div className='flex flex-1 flex-col gap-4'>
        <SelectField
          ariaLabel='RTU Baudrate select'
          // setSelectedOption={setSelectBaudRateOption}
          selectedOption={rtuBaudRate}
          options={availableRTUBaudRates}
          label='Baudrate'
        />
        <div className='flex items-center gap-2'>
          <Checkbox
            className='place-self-center [&>label]:absolute [&>label]:-top-2'
            id='enable-ts485-en-pin'
            // label={enableTS485ENPin ? '' : 'Enable'}
            checked={enableTS485ENPin}
            onCheckedChange={handleEnableTS485ENPin}
          />
          <InputField
            label='TS485 EN Pin'
            className={enableTS485ENPin ? '' : 'invisible'}
            // value={pin} onChange={setPin}
          />
        </div>
      </div>
    </div>
  )
}

export { RTUSettings }
