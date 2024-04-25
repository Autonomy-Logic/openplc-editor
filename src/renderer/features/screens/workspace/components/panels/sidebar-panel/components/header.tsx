import { ComponentProps, ElementType, ReactNode } from 'react'

type IHeaderProps = ComponentProps<'div'> & {
  title: string
  TitleIcon: ElementType
  ButtonIcon: ElementType
}

export const Header = (props: IHeaderProps): ReactNode => {
  const { title, ButtonIcon, TitleIcon } = props
  return (
    <div className='my-3 flex w-[200px] justify-around px-2 '>
      <div className='flex h-8 w-32 cursor-default select-none items-center justify-start gap-2 rounded-lg bg-neutral-100 px-1.5 dark:bg-brand-dark'>
        <TitleIcon />
        <p className='font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>{title}</p>
      </div>
      <button type='button' className='flex h-8 w-10 items-center justify-center rounded-lg bg-brand'>
        <ButtonIcon className='stroke-white' />
      </button>
    </div>
  )
}
