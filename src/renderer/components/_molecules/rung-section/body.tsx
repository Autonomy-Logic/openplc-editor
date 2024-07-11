import { PropsWithChildren } from 'react'

export const RungSectionBody = ({ children }: PropsWithChildren) => {
  return (
    <div
      aria-label='Rung section body'
      className='max-h-fit min-h-52 w-full rounded-b-lg border border-t-0 p-2 dark:border-neutral-800'
    >
      {children}
    </div>
  )
}
