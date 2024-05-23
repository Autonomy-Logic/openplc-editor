import { PauseIcon, PlayIcon } from '@root/renderer/assets'

import { Button } from '../../_atoms'

type IHeaderProps = {
  isPaused: boolean
  setIsPaused: React.Dispatch<React.SetStateAction<boolean>>
}

const Header = ({ isPaused, setIsPaused }: IHeaderProps) => {
  return (
    <div className='header  flex justify-between '>
      <div className='flex gap-4'>
        <Button
          onClick={() => setIsPaused(!isPaused)}
          className='h-7 w-[38px] items-center justify-center rounded-md bg-brand  p-0 outline-none'
        >
          {isPaused ? (
            <PlayIcon fill='#FFFFFF' className='h-fit w-[10px]' />
          ) : (
            <PauseIcon fill='#FFFFFF' className='h-fit w-[10px]' />
          )}
        </Button>
      </div>
    </div>
  )
}

export default Header
