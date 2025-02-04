import { InputWithRef, Select, SelectTrigger } from '../../_atoms'

const SelectField = ({
  label,
  placeholder,
  width,
  ariaLabel,
}: {
  label: string
  placeholder: string
  width?: string
  ariaLabel: string
}) => (
  <div className='flex items-center gap-2.5 text-xs font-medium text-neutral-850 dark:text-neutral-300'>
    <label htmlFor={ariaLabel} className='text-neutral-950 dark:text-white'>
      {label}
    </label>
    <Select>
      <SelectTrigger
        aria-label={ariaLabel}
        withIndicator
        placeholder={placeholder}
        className={`h-7 min-w-0 ${width ? `w-[${width}]` : 'flex-1'} flex justify-between  rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850  dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300`}
      />
    </Select>
  </div>
)

const InputField = ({ label, placeholder }: { label: string; placeholder?: string }) => (
  <div className='flex w-full items-center gap-2'>
    <span className='whitespace-nowrap text-sm font-medium text-white'>{label}</span>
    <InputWithRef
      placeholder={placeholder}
      value=''
      className='h-7 min-w-0 flex-1 rounded-lg border border-neutral-300 p-2 px-2 text-start font-caption text-cp-sm text-neutral-850 focus:border-brand focus:outline-none dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
    />
  </div>
)

const ConfigurationEditor = () => {
  return (
    <div className='flex h-full w-full select-none'>
      <div className='flex h-full w-1/2 flex-col gap-6'>
        <div className='h-[60%]'></div>
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
      <div className='flex h-full w-1/2 flex-col gap-6 px-8 py-3'>
        <span className='text-lg font-medium text-white'>Communication</span>
        <div className='flex flex-col gap-4'>
          <div className='flex items-center gap-2'>
            <div className='h-2 w-2 bg-brand'></div>
            <span className='text-sm font-medium text-white'>Enable Modbus RTU (Serial)</span>
          </div>
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className='flex justify-between'>
              <SelectField label='Interface' placeholder='40028922' width='141px' ariaLabel='Interface select' />
              <SelectField label='Slave ID:' placeholder='40028922' width='148px' ariaLabel='Slave ID select' />
            </div>
          ))}
        </div>
        <hr className='h-[1px] w-full self-stretch bg-brand-light' />
        <div className='flex flex-col gap-6'>
          <div className='h-2 w-2 bg-brand'></div>
          <span className='text-sm font-medium text-white'>Enable Modbus TCP</span>
          <SelectField label='Interface' placeholder='Wifi' ariaLabel='Wifi select' />
          <InputField label='MAC' placeholder='0xDE, 0xAD, 0xBE, 0xEF, 0xDE, 0xAD' />
          <div className='flex w-full justify-between gap-6'>
            <div className='flex w-full flex-col gap-4'>
              <InputField label='IP' />
              <InputField label='Gateway' />
              <InputField label='Wifi SSID' />
            </div>
            <div className='flex w-full flex-col gap-4'>
              <InputField label='DNS' />
              <InputField label='Subnet' />
              <InputField label='Password' />
            </div>
          </div>
          <div className='flex h-8 w-full justify-evenly gap-7'>
            <button className='h-full w-[236px] rounded-lg bg-neutral-100 text-center font-medium text-neutral-1000 dark:bg-neutral-850 dark:text-neutral-100'>
              Restore Defaults
            </button>
            <button className='h-full w-[236px] rounded-lg bg-brand text-center font-medium text-white'>
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export { ConfigurationEditor }
