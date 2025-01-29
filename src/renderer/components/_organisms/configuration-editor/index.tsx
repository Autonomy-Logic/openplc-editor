import { Select, SelectTrigger } from '../../_atoms'

const ConfigurationEditor = () => {
  return (
    <div className='flex h-full w-full select-none'>
      <div className='flex h-full w-1/2 flex-col gap-6 '>
        <div className='h-[60%] bg-red-500'></div>
        <div className='flex h-[40%] flex-col items-center justify-center  '>
          <div className='flex flex-col gap-3'>
            <div className='flex items-center gap-2.5 text-xs font-medium text-neutral-850 dark:text-neutral-300'>
              <label htmlFor='Device select' className='text-neutral-950 dark:text-white'>
                Device
              </label>
              <Select>
                <SelectTrigger
                  aria-label='Device select'
                  withIndicator
                  placeholder=' arduino'
                  className='flex h-7 w-[293px] items-center justify-between rounded-lg border border-neutral-300  px-2 text-start text-neutral-850 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
                />
              </Select>
            </div>
            <div className='flex items-center gap-2.5 text-xs font-medium text-neutral-850 dark:text-neutral-300'>
              <label htmlFor='Programming port select' className='text-neutral-950 dark:text-white'>
                Programming Port
              </label>
              <Select>
                <SelectTrigger
                  aria-label='Programming port select'
                  withIndicator
                  placeholder=' 40028922 '
                  className='flex h-7  w-[188px] items-center justify-between  rounded-lg border  border-neutral-300  px-2 text-start text-neutral-850 dark:border-neutral-850 dark:bg-neutral-900 dark:text-neutral-300'
                />
              </Select>
            </div>
            <div className='flex flex-col  gap-1.5 text-xs font-medium text-neutral-850 dark:text-white'>
              <span className='text-neutral-950 dark:text-white'>Specs:</span>
              <span>CPU: ATmega328P @ 16MHz</span>
              <span>RAM: 2KB</span>
              <span>Flash: 32kb</span>
            </div>
          </div>
        </div>
      </div>
      <hr className='mx-4 h-[99%] w-[1px] self-stretch bg-brand-light pb-12' />
      <div className='flex h-full w-1/2 flex-col gap-6 '></div>
    </div>
  )
}

export { ConfigurationEditor }
