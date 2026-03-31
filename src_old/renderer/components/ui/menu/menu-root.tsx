import { HTMLAttributes, ReactNode } from 'react'

type MenuRootProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode
}

export default function Root({ children, ...props }: MenuRootProps) {
  return (
    <div
      className='flex h-fit min-h-[372px] w-[240px] max-w-[240px] flex-col justify-start bg-transparent text-xl text-[#030303] dark:text-white'
      {...props}
    >
      {children}
    </div>
  )
}
