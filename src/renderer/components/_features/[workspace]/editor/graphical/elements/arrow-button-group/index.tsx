import ArrowButton from '@root/renderer/assets/icons/interface/ArrowButton'

type ArrowButtonGroupProps = {
  onIncrement: () => void
  onDecrement: () => void
  onMouseDown?: (e: React.MouseEvent<HTMLDivElement>) => void
}

const ArrowButtonGroup = ({ onIncrement, onDecrement, onMouseDown }: ArrowButtonGroupProps) => (
  <div className='flex flex-col gap-0.5'>
    <div
      className='flex h-3 w-[17px] cursor-pointer items-center justify-center rounded-[2px] bg-neutral-200 p-0.5 transition-all duration-75 hover:bg-neutral-500 active:bg-neutral-600'
      onClick={onIncrement}
      onMouseDown={onMouseDown}
    >
      <ArrowButton className='h-2 w-3' direction='up' />
    </div>
    <div
      className='flex h-3 w-[17px] cursor-pointer items-center justify-center rounded-[2px] bg-neutral-200 p-0.5 transition-all duration-75 hover:bg-neutral-500 active:bg-neutral-600'
      onClick={onDecrement}
      onMouseDown={onMouseDown}
    >
      <ArrowButton className='h-2 w-3' direction='down' />
    </div>
  </div>
)

export default ArrowButtonGroup
