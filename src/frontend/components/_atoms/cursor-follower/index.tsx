import { type ReactNode, useLayoutEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

import type { Point } from '../../../utils/graphical/radial-menu-geometry'

export type CursorFollowerProps = {
  children: ReactNode
  /** Client position used until the first pointer move. */
  initialPosition: Point
  /** Offset from the pointer so the hot spot stays visible. */
  offset?: Point
  label?: string
}

const DEFAULT_OFFSET: Point = { x: 14, y: 14 }

/**
 * Renders its children next to the mouse pointer. Position updates go straight
 * to the DOM, so pointer moves do not re-render React. Never intercepts events.
 */
const CursorFollower = ({ children, initialPosition, offset = DEFAULT_OFFSET, label }: CursorFollowerProps) => {
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const move = (x: number, y: number) => {
      if (ref.current) ref.current.style.transform = `translate(${x + offset.x}px, ${y + offset.y}px)`
    }
    move(initialPosition.x, initialPosition.y)

    const handlePointerMove = (event: PointerEvent) => move(event.clientX, event.clientY)
    const handleDragOver = (event: DragEvent) => move(event.clientX, event.clientY)
    document.addEventListener('pointermove', handlePointerMove, true)
    document.addEventListener('dragover', handleDragOver, true)
    return () => {
      document.removeEventListener('pointermove', handlePointerMove, true)
      document.removeEventListener('dragover', handleDragOver, true)
    }
  }, [initialPosition.x, initialPosition.y, offset.x, offset.y])

  return createPortal(
    <div
      ref={ref}
      data-testid='cursor-follower'
      aria-hidden
      className='pointer-events-none fixed left-0 top-0 z-[1000] flex items-center gap-1 rounded-md border border-brand bg-brand-dark p-1 shadow-md dark:bg-neutral-950'
    >
      {children}
      {label && <span className='pr-1 font-caption text-cp-sm text-white'>{label}</span>}
    </div>,
    document.body,
  )
}

export { CursorFollower }
