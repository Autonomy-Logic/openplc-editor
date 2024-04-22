import { ReactNode } from 'react'

export const InfoPanel = (): ReactNode => {
  return (
    <div className='flex w-full h-32 p-3'>
      <p
        className='w-full h-full bg-white dark:bg-neutral-950 font-caption text-xs text-start p-2 overflow-y-auto text-neutral-850 dark:text-neutral-300 font-normal rounded-lg border border-brand shadow-2xl
				[&::-webkit-scrollbar]:bg-none
			[&::-webkit-scrollbar]:dark:bg-none
			[&::-webkit-scrollbar-thumb]:bg-none
			[&::-webkit-scrollbar-thumb]:dark:bg-none
			[&::-webkit-scrollbar]:w-0'
      >
        Reads temperature from one DS18B20 one-wire sensor connected to the pin specified in PIN (SINT:PIN) =&gt;
        (REAL:OUT)
      </p>
    </div>
  )
}
