import * as Portal from '@radix-ui/react-portal'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '../../../../../utils/cn'

/** One entry of the rung menu; `null` draws a separator. */
export type RungMenuItem = {
  label: string
  shortcut: string
  onSelect: () => void
  disabled?: boolean
  danger?: boolean
} | null

type RungMenuProps = {
  /** Viewport position of the right click. */
  at: { x: number; y: number }
  items: readonly RungMenuItem[]
  onClose: () => void
}

/** Space kept between a menu and the window's edges, in px. */
const MENU_MARGIN = 8

/**
 * The right-click menu of a rung, at the pointer, moved left or up to stay inside the window; closes on a choice, Escape
 * or a click outside.
 */
export const RungMenu = ({ at, items, onClose }: RungMenuProps) => {
  const ref = useRef<HTMLDivElement | null>(null)
  const [place, setPlace] = useState(at)

  const placeInside = useCallback(
    (element: HTMLDivElement | null) => {
      ref.current = element
      if (element === null) return
      const box = element.getBoundingClientRect()
      const x = Math.max(MENU_MARGIN, Math.min(at.x, window.innerWidth - box.width - MENU_MARGIN))
      const y = Math.max(MENU_MARGIN, Math.min(at.y, window.innerHeight - box.height - MENU_MARGIN))
      setPlace((current) => (current.x === x && current.y === y ? current : { x, y }))
    },
    [at],
  )

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current && event.target instanceof Node && !ref.current.contains(event.target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  return (
    <Portal.Root>
      <div
        ref={placeInside}
        role='menu'
        aria-label='Rung menu'
        className='fixed z-50 w-48 rounded-md border border-neutral-200 bg-white p-1 text-xs shadow-lg dark:border-neutral-800 dark:bg-neutral-950'
        style={{ left: place.x, top: place.y }}
      >
        {items.map((item, index) =>
          item === null ? (
            <div
              key={`separator-${index}`}
              className='mx-1.5 my-1 border-t border-neutral-200 dark:border-neutral-800'
            />
          ) : (
            <button
              key={item.label}
              role='menuitem'
              disabled={item.disabled}
              className={cn(
                'flex w-full items-center justify-between rounded px-2 py-1 text-left hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-900',
                item.danger ? 'text-red-600 dark:text-red-400' : 'text-neutral-850 dark:text-neutral-300',
              )}
              onClick={() => {
                onClose()
                item.onSelect()
              }}
            >
              <span>{item.label}</span>
              <span className='text-neutral-500'>{item.shortcut}</span>
            </button>
          ),
        )}
      </div>
    </Portal.Root>
  )
}
