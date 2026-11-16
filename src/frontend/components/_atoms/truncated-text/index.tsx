import { useCallback, useLayoutEffect, useRef, useState } from 'react'

import { cn } from '../../../utils/cn'
import { Tooltip, TooltipContent, TooltipTrigger } from '../tooltip'

type TruncatedTextProps = {
  text: string
  className?: string
  /** Tooltip placement; defaults to above the text. */
  side?: 'top' | 'right' | 'bottom' | 'left'
  testId?: string
}

/**
 * Single-line text that ends in an ellipsis when it does not fit its
 * container, and reveals the full value in a tooltip on hover — but only
 * while it is actually clipped, so short values never get a redundant tooltip.
 * A clipped value is also a keyboard tab stop, and focusing it opens the tooltip.
 *
 * The cut is CSS-driven (`text-overflow: ellipsis`), so it follows the real
 * column width as the editor is resized instead of a fixed character count.
 * Must be rendered inside a `TooltipProvider`.
 */
const TruncatedText = ({ text, className, side = 'top', testId }: TruncatedTextProps) => {
  const ref = useRef<HTMLSpanElement>(null)
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setClipped(element.scrollWidth > element.clientWidth)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [text])

  const handleOpenChange = useCallback((next: boolean) => {
    const element = ref.current
    setOpen(next && element !== null && element.scrollWidth > element.clientWidth)
  }, [])

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange} delayDuration={300}>
      <TooltipTrigger asChild>
        <span
          ref={ref}
          data-testid={testId}
          tabIndex={clipped ? 0 : undefined}
          className={cn(
            'block min-w-0 truncate focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-brand',
            className,
          )}
        >
          {text}
        </span>
      </TooltipTrigger>
      <TooltipContent
        side={side}
        align='start'
        sideOffset={4}
        data-testid='truncated-text-tooltip'
        className='break-all px-2 py-1 font-caption text-xs'
      >
        {text}
      </TooltipContent>
    </Tooltip>
  )
}

export { TruncatedText }
