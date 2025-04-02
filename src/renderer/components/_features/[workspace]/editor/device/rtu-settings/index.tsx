import { SelectField } from '@root/renderer/components/_molecules/select-field'
import { InputField } from '@root/renderer/components/_organisms/configuration-editor/elements/input'
import { useOpenPLCStore } from '@root/renderer/store'

const RTUSettings = () => {
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
    <div className='flex flex-col gap-4'>
      <div className='flex gap-6'>
        <div className='flex flex-1 flex-col gap-4'>
          <SelectField
            // setSelectedOption={setSelectInterfaceOption}
            selectedOption={rtuInterface}
            options={availableRTUInterfaces}
            label='Interface'
            placeholder='Select interface'
            ariaLabel='Interface select'
          />
          <InputField
            label='Slave ID'
            // value={slaveId} onChange={setSlaveId}
          />
        </div>
        <div className='flex flex-1 flex-col gap-4'>
          <SelectField
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
    </div>
  )
}

export { RTUSettings }
