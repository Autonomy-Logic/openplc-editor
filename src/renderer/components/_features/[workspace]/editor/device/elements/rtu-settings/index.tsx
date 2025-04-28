import { InputField } from '@root/renderer/components/_molecules/input-field'
import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

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
        <InputField
          label='TS485 EN Pin'
          // value={pin} onChange={setPin}
        />
      </div>
    </div>
  )
}

export { RTUSettings }
