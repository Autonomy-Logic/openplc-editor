import { useOpenPLCStore } from '@root/renderer/store'
import { cn } from '@root/utils'
import { ComponentPropsWithoutRef } from 'react'

type IWorkspaceMainContentProps = ComponentPropsWithoutRef<'div'>
const WorkspaceMainContent = (props: IWorkspaceMainContentProps) => {
  const platform = useOpenPLCStore().workspaceState.systemConfigs.OS
  const { children, ...res } = props
  return (
    <div
      className={cn(
        'flex h-full w-full flex-1 flex-grow gap-1 bg-neutral-100 p-2 dark:bg-neutral-900',
        `${platform !== 'linux' && '!rounded-tl-lg'}`,
      )}
      {...res}
    >
      {children}
    </div>
  )
}
export { WorkspaceMainContent }
