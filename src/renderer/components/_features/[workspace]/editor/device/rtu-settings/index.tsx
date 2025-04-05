import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { InputField } from '@root/renderer/components/_organisms/configuration-editor/elements/input'
import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type RTUSettingsProps = ComponentPropsWithoutRef<'div'> & {
  userEnabled?: boolean
}

const RTUSettings = ({ userEnabled, ...props }: RTUSettingsProps) => {
  const {
    deviceAvailableOptions: { availableRTUInterfaces, availableRTUBaudrates },
    deviceDefinitions: {
      configuration: {
        communicationConfiguration: {
          modbusRTU: { rtuInterface, rtuBaudrate },
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
          selectedOption={rtuBaudrate}
          options={availableRTUBaudrates}
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
