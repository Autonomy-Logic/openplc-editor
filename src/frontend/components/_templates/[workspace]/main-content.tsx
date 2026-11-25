import { ComponentPropsWithoutRef } from 'react'

import { cn } from '../../../utils/cn'

type IWorkspaceMainContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceMainContent = (props: IWorkspaceMainContentProps) => {
  const { children, ...res } = props

  return (
    <div
      className={cn(
        'flex h-full w-full min-w-0 flex-1 flex-grow gap-1 overflow-hidden bg-neutral-100 p-2 dark:bg-neutral-900',
        '!rounded-tl-lg',
      )}
      {...res}
    >
      {children}
    </div>
  )
}
export { WorkspaceMainContent }
