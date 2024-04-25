import { CloseIcon, FBDIcon, ILIcon, LDIcon, SFCIcon, STIcon } from '@oplc-icons/index'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type ITabProps = ComponentPropsWithoutRef<'div'> & {
  fileName: string
  fileLang?: 'LD' | 'SFC' | 'FBD' | 'ST' | 'IL'
  currentTab?: boolean
  handleDeleteTab: () => void
}

const LangIcon = {
  LD: <LDIcon className='h-4 w-4' />,
  SFC: <SFCIcon className='h-4 w-4' />,
  FBD: <FBDIcon className='h-4 w-4' />,
  ST: <STIcon className='h-4 w-4' />,
  IL: <ILIcon className='h-4 w-4' />,
}

const Tab = (props: ITabProps) => {
  const { fileName, fileLang = 'LD', currentTab, handleDeleteTab, ...res } = props
  return (
    <div
      role='tab'
      draggable
      className={cn(
        currentTab ? '' : 'border-r border-neutral-300 opacity-[35%]',
        'aria-[current=page]:dark:bg-brand-dark',
        'group relative flex h-[30px] min-w-0 max-w-[160px]  flex-1 cursor-pointer items-center justify-between overflow-hidden bg-neutral-100 px-3 py-2 text-start font-display text-xs font-normal text-neutral-1000 dark:bg-neutral-800 dark:text-white',
      )}
      aria-current={currentTab ? 'page' : undefined}
      {...res}
    >
      {LangIcon[fileLang]}
      <span>{fileName}</span>
      <CloseIcon onClick={() => handleDeleteTab()} className={cn('h-4 w-4 stroke-brand dark:stroke-brand-light')} />
      <span
        aria-hidden='true'
        className={cn(currentTab ? 'bg-brand' : 'bg-transparent', 'absolute inset-x-0 top-0 z-50 h-[3px]')}
      />
    </div>
  )
}

export { Tab }
