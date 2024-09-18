import { DragHandleDots2Icon } from '@radix-ui/react-icons'
import { cn } from '@utils/cn'
import { ComponentProps } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

type IResizablePanelGroupProps = ComponentProps<typeof PanelGroup>

const ResizablePanelGroup = ({ className, ...res }: IResizablePanelGroupProps) => (
  <PanelGroup className={cn('flex h-full w-full data-[panel-group-direction=vertical]:flex-col', className)} {...res} />
)

const ResizablePanel = Panel

type IResizableHandleProps = ComponentProps<typeof PanelResizeHandle> & {
  withHandle?: boolean
}

const ResizableHandle = ({ withHandle, className, ...res }: IResizableHandleProps) => (
  <PanelResizeHandle
    className={cn(
      'bg-border focus-visible:ring-ring relative flex w-px items-center justify-center after:absolute after:inset-y-0 after:left-1/2 after:w-1 after:-translate-x-1/2 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-offset-1 data-[panel-group-direction=vertical]:h-px data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:after:left-0 data-[panel-group-direction=vertical]:after:h-1 data-[panel-group-direction=vertical]:after:w-full data-[panel-group-direction=vertical]:after:-translate-y-1/2 data-[panel-group-direction=vertical]:after:translate-x-0 [&[data-panel-group-direction=vertical]>div]:rotate-90',
      className,
    )}
    {...res}
  >
    {withHandle && (
      <div className='bg-border z-10 flex h-4 w-3 items-center justify-center rounded-sm border'>
        <DragHandleDots2Icon className='h-2.5 w-2.5' />
      </div>
    )}
  </PanelResizeHandle>
)

export { ResizableHandle, ResizablePanel, ResizablePanelGroup }
