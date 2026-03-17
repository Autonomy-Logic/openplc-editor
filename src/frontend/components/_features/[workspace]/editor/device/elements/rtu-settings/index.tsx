import { ComponentPropsWithoutRef } from 'react'

import { useOpenPLCStore } from '@root/frontend/store'
import { cn } from '@root/frontend/utils/cn'
import { InputField } from '../../../../../../_molecules/input-field'
import { SelectField } from '../../../../../../_molecules/select-field'

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
          label='RS485 TX Pin'
          // value={pin} onChange={setPin}
        />
      </div>
    </div>
  )
}

export { RTUSettings }
