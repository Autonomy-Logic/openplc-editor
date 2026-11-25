import { LADDER_STYLE, LADDER_TYPOGRAPHY } from '@root/middleware/shared/utils/ladder-layout'
import type { CSSProperties } from 'react'

import { useLadderThemePalette } from '../../ladder/rung-view'

/** Style of the block type text in the header band, as an LD block draws it. */
export const FBD_BLOCK_TYPE_STYLE: CSSProperties = {
  top: 0,
  left: LADDER_STYLE.blkPad,
  right: LADDER_STYLE.blkPad,
  height: LADDER_STYLE.blkHead,
  fontFamily: LADDER_TYPOGRAPHY.family,
  fontSize: LADDER_TYPOGRAPHY.nameSizePx,
  fontWeight: LADDER_TYPOGRAPHY.semiboldWeight,
  textAlign: 'center',
  justifyContent: 'center',
}

/** Style of a pin name, as an LD block draws it; the colour comes from the theme palette. */
export const FBD_PIN_STYLE: CSSProperties = {
  fontFamily: LADDER_TYPOGRAPHY.family,
  fontSize: LADDER_TYPOGRAPHY.pinFormalSizePx,
  lineHeight: '16px',
}

/** The theme colour of an FBD pin name. */
export const useFbdPinColour = (): string => useLadderThemePalette().muted

/** Class giving FBD text the LD typeface. */
export const FBD_MONO_CLASS = "[font-family:'JetBrains_Mono',ui-monospace,monospace]"

/** Inset of a slim variable or connector shape from the top and bottom of its node, which keeps its stored size. */
export const FBD_SLIM_INSET = 5
