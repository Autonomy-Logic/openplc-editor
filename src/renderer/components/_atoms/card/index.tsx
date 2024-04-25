import { ComponentPropsWithoutRef, ReactNode } from 'react'

type ICardRootProps = ComponentPropsWithoutRef<'div'> & {
  children: ReactNode
}
const CardRoot = (props: ICardRootProps) => {
  const { children, ...res } = props
  return (
    <div
      className='  relative flex h-[180px] w-full min-w-[224px] flex-1 cursor-pointer flex-col items-start justify-start gap-[10px] rounded-lg bg-brand-medium px-[6px] pb-[10px] pt-[6px] text-left font-caption text-xs text-white hover:bg-brand-medium-dark'
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
      className='relative max-h-full max-w-full flex-1 cursor-pointer self-stretch overflow-hidden rounded-md object-cover'
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
    <div className='flex cursor-pointer flex-col items-start justify-start gap-[2px]' {...res}>
      <h3 className='relative leading-4'>{name}</h3>
      <p className='relative text-[10px] leading-3 opacity-40'>{description}</p>
    </div>
  )
}

export { CardLabel, CardPreview, CardRoot }
