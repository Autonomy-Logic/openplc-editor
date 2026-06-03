/**
 * Retro (Windows 98-style) sidebar icons.
 *
 * Authentic period icon art (PNG, transparent background) rendered only by the
 * activity-bar buttons when the 90's theme is active (gated by
 * `useIsNinetiesTheme`). They sit on the silver beveled buttons, so the
 * transparent background lets the button show through. `image-rendering:
 * pixelated` keeps the low-res art crisp when scaled to the rail size.
 */
import buildPng from '../../../assets/icons/retro/build.png'
import debugPng from '../../../assets/icons/retro/debug.png'
import explorerPng from '../../../assets/icons/retro/explorer.png'
import toolboxPng from '../../../assets/icons/retro/open_close_toolbox.png'
import searchPng from '../../../assets/icons/retro/search.png'
import sourceControlPng from '../../../assets/icons/retro/source_control.png'
import startPng from '../../../assets/icons/retro/start.png'

type RetroIconProps = { className?: string }

function RetroImg({ src, alt, className }: { src: string; alt: string; className?: string }) {
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      // `retro-icon` marks it so the theme's icon-darkening CSS leaves it alone.
      className={`retro-icon h-5 w-5 select-none ${className ?? ''}`}
      style={{ imageRendering: 'pixelated' }}
    />
  )
}

export const RetroExplorer = (p: RetroIconProps) => <RetroImg src={explorerPng} alt='Explorer' {...p} />
export const RetroSourceControl = (p: RetroIconProps) => <RetroImg src={sourceControlPng} alt='Source Control' {...p} />
export const RetroSearch = (p: RetroIconProps) => <RetroImg src={searchPng} alt='Search' {...p} />
export const RetroZoom = (p: RetroIconProps) => <RetroImg src={toolboxPng} alt='Open/Close Toolbox' {...p} />
export const RetroBuild = (p: RetroIconProps) => <RetroImg src={buildPng} alt='Build' {...p} />
export const RetroPlay = (p: RetroIconProps) => <RetroImg src={startPng} alt='Play' {...p} />
export const RetroDebugger = (p: RetroIconProps) => <RetroImg src={debugPng} alt='Debugger' {...p} />
