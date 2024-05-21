import ViewIcon from '@root/renderer/assets/icons/interface/View'
import ZapIcon from '@root/renderer/assets/icons/interface/Zap'

export default function VariablePanel() {
  return (
    <div className='flex h-auto w-[20%] min-w-52 flex-col gap-2 overflow-auto rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-base font-medium text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex h-7 w-[90px] items-center gap-1 rounded-lg bg-neutral-100 p-1 dark:bg-brand-dark'>
        <ZapIcon className='h-4 w-4' />
        <p>Variaveis</p>
      </div>
      <div className='flex h-auto flex-col gap-2 whitespace-nowrap '>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <ViewIcon /> nao sei
          </div>
          <p className='text-neutral-400'>BOOL</p>
        </div>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <ViewIcon /> nao sei
          </div>
          <p className='text-neutral-400'>BOOL</p>
        </div>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2 '>
            <ViewIcon /> nao sei
          </div>
          <p className='text-neutral-400'>BOOL</p>
        </div>
      </div>
      <hr className='w-full stroke-neutral-200 stroke-[1.5px]' />

      <div className='flex h-full flex-col gap-2'>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <p>TOF0</p>
          </div>
          <p className='text-neutral-400'>TOF0</p>
        </div>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <p>TON0</p>
          </div>
          <p className='text-neutral-400'>TON0</p>
        </div>
      </div>
    </div>
  )
}
