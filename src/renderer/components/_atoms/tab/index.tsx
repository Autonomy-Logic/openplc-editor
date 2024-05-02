import { CloseIcon, FBDIcon, ILIcon, LDIcon, SFCIcon, STIcon } from '@oplc-icons/index'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type ITabProps = ComponentPropsWithoutRef<'div'> & {
  fileName: string
  fileLang?: 'ld' | 'sfc' | 'fbd' | 'st' | 'il'
  fileType?: 'program' | 'function' | 'function-block'
  currentTab?: boolean
  handleDeleteTab: () => void
  handleClickedTab: () => void
}

const LangIcon = {
  ld: <LDIcon className='h-4 w-4' />,
  sfc: <SFCIcon className='h-4 w-4' />,
  fbd: <FBDIcon className='h-4 w-4' />,
  st: <STIcon className='h-4 w-4' />,
  il: <ILIcon className='h-4 w-4' />,
}

const Tab = (props: ITabProps) => {
  const { fileName, fileLang = 'ld', currentTab, handleDeleteTab, handleClickedTab, ...res } = props
  return (
    <div
      role='tab'
      draggable
      className={cn(
        currentTab ? '' : 'border-r border-neutral-300 opacity-[35%]',
        'aria-[current=page]:dark:bg-brand-dark',
        'group relative flex h-[30px] min-w-0 max-w-[160px] flex-1 cursor-pointer items-center justify-between overflow-hidden bg-neutral-100 text-start font-display text-xs font-normal text-neutral-1000 dark:bg-neutral-800 dark:text-white',
      )}
      aria-current={currentTab ? 'page' : undefined}
      {...res}
    >
      <div className='flex h-full w-full px-3 py-2 [&_svg]:mr-1' onClick={() => handleClickedTab()}>
        {LangIcon[fileLang]}
        <span>{fileName}</span>
        <span
          aria-hidden='true'
          className={cn(currentTab ? 'bg-brand' : 'bg-transparent', 'absolute inset-x-0 top-0 z-50 h-[3px]')}
        />
      </div>
      <CloseIcon
        onClick={() => handleDeleteTab()}
        className={cn(
          'absolute right-2 z-[999] h-4 w-4 rounded-sm stroke-brand p-[0.25px] hover:bg-neutral-300 dark:stroke-brand-light dark:hover:bg-neutral-700',
        )}
      />
    </div>
  )
}

export { Tab }
