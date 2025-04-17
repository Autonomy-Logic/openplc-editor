import { PropsWithChildren } from 'react'

import { Tooltip,TooltipContent, TooltipProvider, TooltipTrigger } from '../../_atoms/tooltip'

export const TooltipButton = ({ children, tooltipContent }: PropsWithChildren & { tooltipContent: string }) => {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger>{children}</TooltipTrigger>
        <TooltipContent side='right' sideOffset={5}>
          <div className='text-xs font-normal'>{tooltipContent}</div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
