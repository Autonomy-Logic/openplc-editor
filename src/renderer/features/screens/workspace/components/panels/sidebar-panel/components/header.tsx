import { ComponentProps, ElementType, ReactNode } from 'react'

type IHeaderProps = ComponentProps<'div'> & {
  title: string
  TitleIcon: ElementType
  ButtonIcon: ElementType
}

export const Header = (props: IHeaderProps): ReactNode => {
  const { title, ButtonIcon, TitleIcon } = props
  return (
    <div className='flex justify-around w-[200px] my-3 px-2 '>
      <div className='flex items-center justify-start px-1.5 w-32 h-8 gap-2 rounded-lg cursor-default select-none bg-neutral-100 dark:bg-brand-dark'>
        <TitleIcon />
        <p className='font-caption text-xs font-medium text-neutral-1000 dark:text-neutral-50'>{title}</p>
      </div>
      <button type='button' className='w-10 h-8 rounded-lg bg-brand flex justify-center items-center'>
        <ButtonIcon className='stroke-white' />
      </button>
    </div>
  )
}
