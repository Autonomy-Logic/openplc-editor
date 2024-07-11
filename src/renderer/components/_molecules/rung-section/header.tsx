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
      className={cn(
        'flex w-full flex-row items-center rounded-lg border bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900',
        {
          'rounded-b-none border-b-0': isOpen,
        },
      )}
    >
      <InputWithRef className='w-full bg-transparent outline-none' placeholder='Rung name and description' />
      <button onClick={onClick}>
        <StickArrowIcon direction={isOpen ? 'down' : 'up'} className='stroke-[#0464FB]' />
      </button>
    </div>
  )
}
