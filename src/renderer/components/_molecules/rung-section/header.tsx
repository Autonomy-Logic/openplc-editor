import { InputWithRef } from '@components/_atoms/input'
import { StickArrowIcon } from '@root/renderer/assets/icons/interface/StickArrow'
import { cn } from '@root/utils'

type RungSectionHeaderProps = {
  isOpen: boolean
  onClick: () => void
}

export const RungSectionHeader = ({ isOpen, onClick }: RungSectionHeaderProps) => {
  return (
    <div
      aria-label='Rung section header'
      className={cn(
        'flex w-full flex-row items-center rounded-lg border bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900',
        {
          'rounded-b-none border-b-0': isOpen,
        },
      )}
    >
      <InputWithRef
        aria-label='Rung section name and description'
        className='w-full bg-transparent outline-none'
        placeholder='Rung name and description'
      />
      <button
        aria-label='Expand section body button'
        onClick={onClick}
        className='rounded-md p-1 hover:bg-neutral-200 dark:hover:bg-neutral-800'
      >
        <StickArrowIcon direction={isOpen ? 'down' : 'up'} className='stroke-[#0464FB] dark:stroke-brand-light' />
      </button>
    </div>
  )
}
