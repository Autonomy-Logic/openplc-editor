import { useCallback, useRef, useState } from 'react'

import { cn } from '../../../utils/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'

type TruncatedTextProps = {
  text: string
  className?: string
  /** Tooltip placement; defaults to above the text. */
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Single-line text that ends in an ellipsis when it does not fit its
 * container, and reveals the full value in a tooltip on hover or keyboard
 * focus — but only while it is actually clipped, so short values never get a
 * redundant tooltip.
 *
 * The cut is CSS-driven (`text-overflow: ellipsis`), so it follows the real
 * column width as the editor is resized instead of a fixed character count.
 * Must be rendered inside a `TooltipProvider`.
 */
const TruncatedText = ({ text, className, side = 'top' }: TruncatedTextProps) => {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)

  const handleOpenChange = useCallback((next: boolean) => {
    const element = ref.current
    setOpen(next && element !== null && element.scrollWidth > element.clientWidth)
  }, [])

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange} delayDuration={300}>
      <TooltipTrigger asChild>
        <span ref={ref} className={cn('block min-w-0 truncate', className)}>
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent side={side} align='start' sideOffset={4} className='break-all px-2 py-1 font-caption text-xs'>
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

export { TruncatedText }
