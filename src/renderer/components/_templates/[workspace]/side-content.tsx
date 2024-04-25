import { ComponentPropsWithoutRef } from 'react'

type IWorkspaceSideContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceSideContent = (props: IWorkspaceSideContentProps) => {
  const { children, ...res } = props
  return (
    <div
      className='flex h-full w-14 flex-col justify-between border-t-inherit bg-brand-dark pb-10 dark:bg-neutral-950'
      {...res}
    >
      {children}
    </div>
  )
}

export { WorkspaceSideContent }
