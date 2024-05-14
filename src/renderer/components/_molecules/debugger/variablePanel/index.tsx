import { DebuggerIcon } from '@root/renderer/assets'

export default function VariablePanel() {
  return (
    <div className='h-full w-[20%] rounded-lg border-[0.75px] border-neutral-200 bg-white p-2'>
      <div className='h-7 w-[88px] bg-neutral-100'>Variaveis</div>
      <div className='flex h-full flex-col gap-2'>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <DebuggerIcon /> nao sei
          </div>
          BOOL
        </div>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <DebuggerIcon /> nao sei
          </div>
          BOOL
        </div>
        <div className='flex h-4 w-full items-center justify-between gap-2'>
          <div className='flex items-center gap-2'>
            <DebuggerIcon /> nao sei
          </div>
          BOOL
        </div>
      </div>
    </div>
  )
}
