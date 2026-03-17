import { HTMLAttributes } from 'react'

type CardRootProps = HTMLAttributes<HTMLDivElement>

export default function Root({ ...props }: CardRootProps) {
  return (
    <div
      className='  relative flex h-[180px] w-full min-w-[224px] flex-1 cursor-pointer flex-col items-start justify-start gap-[10px] rounded-lg bg-brand-medium px-[6px] pb-[10px] pt-[6px] text-left font-caption text-xs text-white hover:bg-brand-medium-dark'
      {...props}
    />
  )
}
