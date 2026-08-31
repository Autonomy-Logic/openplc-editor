import { ComponentPropsWithoutRef } from 'react'

import { DownloadIcon } from '../../../../assets/icons/interface/Download'
import { useIsNinetiesTheme } from '../../../../hooks/use-nineties-theme'
import { ActivityBarButton } from '../../../_atoms/buttons/activity-bar'
import { RetroBuild } from '../../../_atoms/retro-icons'

/**
 * Build a Library Project into its `.stlib`.
 *
 * A plain button, not the program build's options popover: a library
 * build has exactly one thing it can do.  It used to offer a "Clean
 * build" alongside it, whose only effect was to bypass the MD5 cache
 * on the avr-gcc verification pass — and that pass is gone, so the
 * second row would have been a no-op.  Same icon as the program build
 * so the two read as the same action for the two project types.
 */
export const BuildLibraryButton = (props: ComponentPropsWithoutRef<typeof ActivityBarButton>) => {
  const isNineties = useIsNinetiesTheme()
  return (
    <ActivityBarButton aria-label='Build Library' {...props}>
      {isNineties ? <RetroBuild /> : <DownloadIcon />}
    </ActivityBarButton>
  )
}
