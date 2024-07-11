import { PlusIcon } from '@root/renderer/assets'

type CreateRungProps = {
  onClick: () => void
}

export const CreateRung = ({ onClick }: CreateRungProps) => {
  return (
    <div className='flex w-full flex-row items-center justify-between rounded-lg border bg-transparent p-2 opacity-40 dark:border-neutral-800'>
      <p>Create new section</p>
      <button onClick={onClick}>
        <PlusIcon size='sm' className='stroke-[#0464FB]' />
      </button>
    </div>
  )
}
