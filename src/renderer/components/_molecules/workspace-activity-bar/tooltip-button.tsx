import { PropsWithChildren } from 'react'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../_atoms/tooltip'

export const TooltipSidebarWrapperButton = ({
  children,
  tooltipContent,
}: PropsWithChildren & { tooltipContent: string }) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent side='right' sideOffset={5} >
          <div className='text-sm font-normal'>{tooltipContent}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
