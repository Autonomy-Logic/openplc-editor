import * as Popover from '@radix-ui/react-popover'
import { ReactNode, useState } from 'react'

import { DownloadIcon } from '../../../../assets/icons/interface/Download'
import { useIsNinetiesTheme } from '../../../../hooks/use-nineties-theme'
import { cn } from '../../../../utils/cn'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { RetroBuild } from '../../../_atoms/retro-icons'
import { SidebarTooltipContent, Tooltip, TooltipProvider, TooltipTrigger } from '../../../_atoms/tooltip'

export type BuildOption = 'build-only' | 'build-upload' | 'clean-upload'

type BuildOptionsPopoverProps = {
  /** Disables the trigger button entirely (e.g. compile-in-progress, simulator selected). */
  disabled?: boolean
  /** Tooltip text to show on the trigger button. */
  triggerTooltip: string
  /** Whether upload-bearing options are available. False ⇒ greyed-out with tooltip. */
  uploadAvailable: boolean
  /** Tooltip shown when an upload-bearing option is disabled. */
  uploadDisabledReason: string
  /**
   * Render the library-build option set instead of the program one:
   * "Build" and "Clean build" — no upload variants.  The library
   * build pipeline emits `build-only` for a normal build and
   * `clean-upload` for a clean build (the enum is reused so the
   * popover stays a single component).
   */
  libraryMode?: boolean
  onSelect: (option: BuildOption) => void
}

type OptionRowProps = {
  label: string
  description: string
  disabled: boolean
  disabledReason: string
  onClick: () => void
}

const OptionRow = ({ label, description, disabled, disabledReason, onClick }: OptionRowProps): ReactNode => {
  const row = (
    <button
      type='button'
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'flex w-full select-none flex-col items-start rounded-md px-2 py-2 text-left outline-none',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : // `focus-visible` (vs `focus`) only paints the highlight
            // when focus came from keyboard navigation.  Radix
            // Popover auto-focuses the first row on open, which
            // with plain `focus:` left "Build" looking permanently
            // selected even when the mouse was hovering "Clean
            // build" — two backgrounds visible at once.
            'cursor-pointer hover:bg-neutral-100 focus-visible:bg-neutral-100 dark:hover:bg-neutral-900 dark:focus-visible:bg-neutral-900',
      )}
    >
      <span className='font-caption text-cp-sm font-medium text-neutral-1000 dark:text-neutral-300'>{label}</span>
      <span className='font-caption text-cp-xs font-normal text-neutral-700 opacity-70 dark:text-neutral-300'>
        {description}
      </span>
    </button>
  )

  if (!disabled) return row

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='block w-full'>{row}</span>
        </TooltipTrigger>
        <SidebarTooltipContent side='right' sideOffset={8} arrow={false}>
          <span className='font-caption text-xs'>{disabledReason}</span>
        </SidebarTooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export const BuildOptionsPopover = ({
  disabled,
  triggerTooltip,
  uploadAvailable,
  uploadDisabledReason,
  libraryMode,
  onSelect,
}: BuildOptionsPopoverProps): ReactNode => {
  const [open, setOpen] = useState(false)

  const choose = (option: BuildOption) => {
    setOpen(false)
    onSelect(option)
  }

  const isNineties = useIsNinetiesTheme()

  return (
    <Popover.Root open={open && !disabled} onOpenChange={setOpen}>
      <TooltipProvider delayDuration={250}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className='flex w-full justify-center'>
              <Popover.Trigger asChild>
                <ActivityBarButton
                  aria-label='Build options'
                  disabled={disabled}
                  className={cn(disabled && 'cursor-not-allowed opacity-50 [&>*:first-child]:hover:bg-transparent')}
                >
                  {isNineties ? <RetroBuild /> : <DownloadIcon />}
                </ActivityBarButton>
              </Popover.Trigger>
            </div>
          </TooltipTrigger>
          <SidebarTooltipContent side='right' sideOffset={5} arrow={false}>
            <div className='w-full text-center font-caption text-xs'>{triggerTooltip}</div>
          </SidebarTooltipContent>
        </Tooltip>
      </TooltipProvider>
      <Popover.Portal>
        <Popover.Content
          side='right'
          align='start'
          sideOffset={10}
          alignOffset={-4}
          className='box z-50 flex h-fit w-[230px] flex-col gap-1 rounded-lg bg-white p-2 dark:bg-neutral-950'
        >
          {libraryMode ? (
            <>
              <OptionRow
                label='Build'
                description='Compile the library into a .stlib archive.'
                disabled={false}
                disabledReason=''
                onClick={() => choose('build-only')}
              />
              <OptionRow
                label='Clean build'
                description='Skip the verification cache and re-verify against the simulator.'
                disabled={false}
                disabledReason=''
                onClick={() => choose('clean-upload')}
              />
            </>
          ) : (
            <>
              <OptionRow
                label='Build only'
                description='Compile the program without uploading.'
                disabled={false}
                disabledReason=''
                onClick={() => choose('build-only')}
              />
              <OptionRow
                label='Build and upload'
                description='Compile and upload to the target device.'
                disabled={!uploadAvailable}
                disabledReason={uploadDisabledReason}
                onClick={() => choose('build-upload')}
              />
              <OptionRow
                label='Clean build and upload'
                description='Invalidate the cache, fully recompile, then upload.'
                disabled={!uploadAvailable}
                disabledReason={uploadDisabledReason}
                onClick={() => choose('clean-upload')}
              />
            </>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
