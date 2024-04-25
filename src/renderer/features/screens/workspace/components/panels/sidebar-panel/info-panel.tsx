import { ReactNode } from 'react'

export const InfoPanel = (): ReactNode => {
  return (
    <div className='flex h-32 w-full p-3'>
      <p
        className='h-full w-full overflow-y-auto rounded-lg border border-brand bg-white p-2 text-start font-caption text-xs font-normal text-neutral-850 shadow-2xl dark:bg-neutral-950 dark:text-neutral-300
				[&::-webkit-scrollbar-thumb]:bg-none
			[&::-webkit-scrollbar-thumb]:dark:bg-none
			[&::-webkit-scrollbar]:w-0
			[&::-webkit-scrollbar]:bg-none
			[&::-webkit-scrollbar]:dark:bg-none'
      >
        Reads temperature from one DS18B20 one-wire sensor connected to the pin specified in PIN (SINT:PIN) =&gt;
        (REAL:OUT)
      </p>
    </div>
  )
}
