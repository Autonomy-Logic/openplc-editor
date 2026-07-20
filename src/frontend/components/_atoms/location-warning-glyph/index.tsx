import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../tooltip'

/**
 * Amber warning triangle shown in a variable's location cell, with an
 * explanatory tooltip rendered through the app's shared Radix `Tooltip`
 * (same look as the sidebar / HAL help-icon tooltips). Used for both the
 * orphaned-alias and the manual-address-conflict warnings.
 *
 * `pointer-events-auto` re-enables hover on the glyph: the display-mode cell
 * that hosts it is `pointer-events-none`, so the trigger would otherwise never
 * see the pointer.
 */
function LocationWarningGlyph({ label, tooltip }: { label: string; tooltip: string }) {
  return (
    <TooltipProvider>
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            aria-label={label}
            className='pointer-events-auto inline-flex cursor-help items-center text-amber-500 focus:outline-none dark:text-amber-400'
          >
            <svg viewBox='0 0 16 16' fill='currentColor' className='h-3.5 w-3.5' aria-hidden='true'>
              <path d='M8 1.5 1 14h14L8 1.5Zm0 4.25 5.13 9.13H2.87L8 5.75Zm-.75 3v3h1.5v-3h-1.5Zm0 4v1.25h1.5V12.75h-1.5Z' />
            </svg>
          </span>
        </TooltipTrigger>
        <TooltipContent side='top' align='start' sideOffset={6} className='text-xs'>
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { LocationWarningGlyph }
