import { HTMLAttributes } from 'react'

type CardLabelProps = HTMLAttributes<HTMLDivElement> & {
  title: string
  description: string
}

export default function Label({ title, description, ...props }: CardLabelProps) {
  return (
    <div className='flex cursor-pointer flex-col items-start justify-start gap-[2px]' {...props}>
      <h3 className='relative leading-4'>{title}</h3>
      <p className='relative text-[10px] leading-3 opacity-40'>{description}</p>
    </div>
  )
}
