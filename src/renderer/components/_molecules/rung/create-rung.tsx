import { PlusIcon } from '@root/renderer/assets'

type CreateRungProps = {
  onClick: () => void
}

export const CreateRung = ({ onClick }: CreateRungProps) => {
  return (
    <div
      aria-label='Create new rung'
      className='flex w-full select-none flex-row items-center justify-between rounded-lg border bg-transparent p-1 opacity-40 hover:opacity-100 dark:border-neutral-800'
    >
      <p className='ml-2 cursor-default text-xs'>Create new rung</p>
      <button
        aria-label='Create new rung button'
        onClick={onClick}
        className='mr-1 rounded-md p-1 hover:bg-neutral-100 dark:hover:bg-neutral-900'
      >
        <PlusIcon size='sm' className='stroke-[#0464FB] dark:stroke-brand-light' />
      </button>
    </div>
  )
}
