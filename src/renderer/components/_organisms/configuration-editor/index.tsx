import { Select, SelectTrigger } from '../../_atoms'

const SelectField = ({
  label,
  placeholder,
  width,
  ariaLabel,
}: {
  label: string
  placeholder: string
  width: string
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
        className={`flex h-7 w-[${width}] items-center justify-between rounded-lg border border-neutral-300 px-2 text-start text-neutral-850 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300`}
      />
    </Select>
  </div>
)

const CommunicationField = ({
  label,
  placeholder,
  width,
  ariaLabel,
}: {
  label: string
  placeholder: string
  width: string
  ariaLabel: string
}) => (
  <div className='flex items-center gap-2  text-xs'>
    <span className='text-sm font-medium dark:text-neutral-300'>{label}</span>
    <Select>
      <SelectTrigger
        aria-label={ariaLabel}
        withIndicator
        placeholder={placeholder}
        className={`flex h-7 w-[${width}] items-center justify-between rounded-lg border border-neutral-300 px-2 text-start text-neutral-850 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300`}
      />
    </Select>
  </div>
)

const ConfigurationEditor = () => {
  return (
    <div className='flex h-full w-full select-none'>
      <div className='flex h-full w-1/2 flex-col gap-6'>
        <div className='h-[60%]'></div>
        <div className='flex h-[40%] flex-col items-center justify-center'>
          <div className='flex flex-col gap-3'>
            <SelectField label='Device' placeholder='arduino' width='293px' ariaLabel='Device select' />
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
              <CommunicationField label='Interface' placeholder='40028922' width='141px' ariaLabel='Interface select' />
              <CommunicationField label='Slave ID:' placeholder='40028922' width='148px' ariaLabel='Slave ID select' />
            </div>
          ))}
        </div>
        <hr className=' h-[1px] w-full self-stretch bg-brand-light ' />
        <div className='flex items-center gap-2'>
            <div className='h-2 w-2 bg-brand'></div>
            <span className='text-sm font-medium text-white'>Enable Modbus TCP</span>
          </div>
      </div>
    </div>
  )
}

export { ConfigurationEditor }
