import { PropsWithChildren } from 'react'

import { SidebarTooltipContent, Tooltip, TooltipProvider, TooltipTrigger } from '../../_atoms/tooltip'

export const TooltipSidebarWrapperButton = ({
  children,
  tooltipContent,
}: PropsWithChildren & { tooltipContent: string }) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <SidebarTooltipContent side='right' sideOffset={5} arrow={false}>
          <div className='w-full text-center font-caption text-xs'>{tooltipContent}</div>
        </SidebarTooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
