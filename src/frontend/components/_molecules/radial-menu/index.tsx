import { type MouseEvent as ReactMouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { cn } from '../../../utils/cn'
import {
  clampMenuCenter,
  describeSlicePath,
  getSliceAnchor,
  getSliceIndexAtPoint,
  type Point,
  RADIAL_MENU_INNER_RADIUS,
  RADIAL_MENU_OUTER_RADIUS,
} from '../../../utils/graphical/radial-menu-geometry'

export type RadialMenuItem = {
  id: string
  label: string
  icon: ReactNode
  /** Secondary text shown under the label in the centre while the item is hovered. */
  hint?: string
}

export type RadialMenuProps = {
  items: readonly RadialMenuItem[]
  /** Requested centre, in client (viewport) coordinates. Clamped to keep the menu on screen. */
  position: Point
  onSelect: (id: string) => void
  onClose: () => void
  /** Centre text while no item is hovered. */
  title?: string
  ariaLabel?: string
  innerRadius?: number
  outerRadius?: number
}

const ICON_RING_RATIO = 0.5

const RadialMenu = ({
  items,
  position,
  onSelect,
  onClose,
  title,
  ariaLabel = 'Radial menu',
  innerRadius = RADIAL_MENU_INNER_RADIUS,
  outerRadius = RADIAL_MENU_OUTER_RADIUS,
}: RadialMenuProps) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const center = clampMenuCenter(position, outerRadius, viewport)
  const size = outerRadius * 2
  const iconRadius = innerRadius + (outerRadius - innerRadius) * ICON_RING_RATIO

  const paths = useMemo(
    () => items.map((_, index) => describeSlicePath(index, items.length, innerRadius, outerRadius)),
    [items, innerRadius, outerRadius],
  )

  useEffect(() => {
    setHoveredIndex(null)
  }, [position.x, position.y])

  useEffect(() => {
    const isInside = (target: EventTarget | null) =>
      target instanceof Node && containerRef.current !== null && containerRef.current.contains(target)

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0 || isInside(event.target)) return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const handleContextMenu = (event: MouseEvent) => {
      if (isInside(event.target)) return
      onCloseRef.current()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      onCloseRef.current()
    }
    const handleBlur = () => onCloseRef.current()

    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('contextmenu', handleContextMenu, true)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('blur', handleBlur)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('contextmenu', handleContextMenu, true)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [])

  const indexAt = (event: ReactMouseEvent): number | null =>
    getSliceIndexAtPoint(
      { x: event.clientX - center.x, y: event.clientY - center.y },
      items.length,
      innerRadius,
      outerRadius,
    )

  const handleMouseMove = (event: ReactMouseEvent) => {
    const index = indexAt(event)
    if (index !== hoveredIndex) setHoveredIndex(index)
  }

  const handleClick = (event: ReactMouseEvent) => {
    event.stopPropagation()
    const index = indexAt(event)
    const item = index === null ? undefined : items[index]
    if (item) onSelect(item.id)
    else onClose()
  }

  const hovered = hoveredIndex === null ? undefined : items[hoveredIndex]

  return createPortal(
    <div
      ref={containerRef}
      role='menu'
      aria-label={ariaLabel}
      data-testid='radial-menu'
      className='fixed z-[1000] select-none'
      style={{ left: center.x - outerRadius, top: center.y - outerRadius, width: size, height: size }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredIndex(null)}
      onClick={handleClick}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <svg
        width={size}
        height={size}
        viewBox={`${-outerRadius} ${-outerRadius} ${size} ${size}`}
        className='absolute inset-0 overflow-visible drop-shadow-lg'
        aria-hidden
      >
        <circle
          r={innerRadius - 2}
          className='fill-brand-dark stroke-brand-medium-dark dark:fill-neutral-950 dark:stroke-neutral-800'
        />
        {paths.map((path, index) => (
          <path
            key={items[index]?.id ?? index}
            d={path}
            data-hovered={hoveredIndex === index}
            className={cn(
              'cursor-pointer stroke-brand-medium-dark transition-colors duration-100 dark:stroke-neutral-800',
              hoveredIndex === index
                ? 'fill-brand stroke-brand dark:stroke-brand'
                : 'fill-brand-dark dark:fill-neutral-950',
            )}
          />
        ))}
      </svg>

      {items.map((item, index) => {
        const anchor = getSliceAnchor(index, items.length, iconRadius)
        return (
          <div
            key={item.id}
            role='menuitem'
            aria-label={item.label}
            data-testid={`radial-menu-item-${item.id}`}
            className={cn(
              'pointer-events-none absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center transition-transform duration-100',
              hoveredIndex === index && 'scale-125',
            )}
            style={{ left: outerRadius + anchor.x, top: outerRadius + anchor.y }}
          >
            {item.icon}
          </div>
        )
      })}

      <div
        className='pointer-events-none absolute flex flex-col items-center justify-center text-center'
        style={{
          left: outerRadius - innerRadius,
          top: outerRadius - innerRadius,
          width: innerRadius * 2,
          height: innerRadius * 2,
        }}
      >
        <span
          data-testid='radial-menu-label'
          className={cn(
            'px-1 font-caption text-xs font-medium leading-tight',
            hovered ? 'text-white' : 'text-neutral-400',
          )}
        >
          {hovered?.label ?? title ?? ''}
        </span>
        {hovered?.hint && <span className='mt-0.5 font-caption text-cp-xs text-neutral-300'>{hovered.hint}</span>}
      </div>
    </div>,
    document.body,
  )
}

export { RadialMenu }
