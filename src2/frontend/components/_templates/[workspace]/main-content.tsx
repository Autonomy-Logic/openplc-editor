import { ComponentPropsWithoutRef } from 'react'

import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'

type IWorkspaceMainContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceMainContent = (props: IWorkspaceMainContentProps) => {
  const {
    workspace: {
      systemConfigs: { OS },
    },
  } = useOpenPLCStore()
  const { children, ...res } = props

  return (
    <div
      className={cn(
        'flex h-full w-full flex-1 flex-grow gap-1 bg-neutral-100 p-2 dark:bg-neutral-900',
        `${OS !== 'linux' && '!rounded-tl-lg'}`,
      )}
      {...res}
    >
      {children}
    </div>
  )
}
export { WorkspaceMainContent }
