import { ComponentPropsWithoutRef, ReactNode } from 'react'

type ICardRootProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode
}
const CardRoot = (props: ICardRootProps) => {
  const { children, ...res } = props
  return (
    <div
      className='  relative flex flex-1 flex-col items-start justify-start bg-brand-medium w-full min-w-[224px] h-[180px] rounded-lg px-[6px] pt-[6px] pb-[10px] gap-[10px] text-left text-xs text-white font-caption hover:bg-brand-medium-dark cursor-pointer'
      {...res}
    >
      {children}
    </div>
  )
}

type ICardPreviewProps = ComponentPropsWithoutRef<'img'>
const CardPreview = (props: ICardPreviewProps) => {
  return (
    // biome-ignore lint/a11y/useAltText: <explanation>
    <img
      className='self-stretch flex-1 relative rounded-md max-w-full overflow-hidden max-h-full object-cover cursor-pointer'
      {...props}
    />
  )
}

type ICardLabelProps = ComponentPropsWithoutRef<'div'> & {
  name: string
  description: string
}
const CardLabel = (props: ICardLabelProps) => {
  const { name, description, ...res } = props
  return (
    <div className='flex flex-col items-start justify-start gap-[2px] cursor-pointer' {...res}>
      <h3 className='relative leading-4'>{name}</h3>
      <p className='relative text-[10px] leading-3 opacity-40'>{description}</p>
    </div>
  )
}

export { CardLabel,CardPreview, CardRoot }
