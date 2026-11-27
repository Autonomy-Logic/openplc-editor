import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

type VirtualRowsOptions = {
  /** Number of rows in the list. */
  count: number
  /** Fixed height of every row, in pixels. */
  rowHeight: number
  /** Rows mounted beyond each edge of the visible area. */
  overscan: number
  /** The element that scrolls the rows. */
  scrollElement: RefObject<HTMLElement | null>
  /** Distance in pixels from the top of the scroll content to the first row. */
  getOffsetTop: () => number
  /** When false, every row is in the window. */
  enabled: boolean
}

type VirtualRowsWindow = {
  /** First row in the window. */
  start: number
  /** Row after the last one in the window. */
  end: number
  /** Height standing in for the rows before the window. */
  paddingTop: number
  /** Height standing in for the rows after the window. */
  paddingBottom: number
  /** Scrolls the least needed to show the row at `index` whole. */
  scrollToIndex: (index: number) => void
}

type VirtualRowsViewport = { scrollTop: number; clientHeight: number; offsetTop: number }

/** The rows covering the viewport plus `overscan` on each side, clamped to `[0, count]`. */
const computeRowRange = (
  { scrollTop, clientHeight, offsetTop }: VirtualRowsViewport,
  count: number,
  rowHeight: number,
  overscan: number,
): { start: number; end: number } => {
  const top = Math.max(0, scrollTop - offsetTop)
  const bottom = Math.max(0, scrollTop - offsetTop + clientHeight)
  const start = Math.min(count, Math.max(0, Math.floor(top / rowHeight) - overscan))
  const end = Math.min(count, Math.max(start, Math.ceil(bottom / rowHeight) + overscan))
  return { start, end }
}

/** Windows a list of fixed-height rows inside a scrolling element, so only the rows near the viewport mount. */
const useVirtualRows = ({
  count,
  rowHeight,
  overscan,
  scrollElement,
  getOffsetTop,
  enabled,
}: VirtualRowsOptions): VirtualRowsWindow => {
  const [range, setRange] = useState(() => ({ start: 0, end: enabled ? Math.min(count, overscan * 2) : count }))
  const getOffsetTopRef = useRef(getOffsetTop)
  getOffsetTopRef.current = getOffsetTop

  const measure = useCallback((): VirtualRowsViewport | null => {
    const element = scrollElement.current
    if (!element) return null
    return { scrollTop: element.scrollTop, clientHeight: element.clientHeight, offsetTop: getOffsetTopRef.current() }
  }, [scrollElement])

  const update = useCallback(() => {
    if (!enabled) {
      setRange((previous) => (previous.start === 0 && previous.end === count ? previous : { start: 0, end: count }))
      return
    }
    const viewport = measure()
    if (!viewport) return
    const next = computeRowRange(viewport, count, rowHeight, overscan)
    setRange((previous) => (previous.start === next.start && previous.end === next.end ? previous : next))
  }, [count, enabled, measure, overscan, rowHeight])

  useLayoutEffect(update, [update])

  useEffect(() => {
    const element = scrollElement.current
    if (!enabled || !element) return undefined
    element.addEventListener('scroll', update, { passive: true })
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => update())
    observer?.observe(element)
    return () => {
      element.removeEventListener('scroll', update)
      observer?.disconnect()
    }
  }, [enabled, scrollElement, update])

  const scrollToIndex = useCallback(
    (index: number) => {
      const element = scrollElement.current
      const viewport = measure()
      if (!element || !viewport || index < 0 || index >= count) return
      const rowTop = viewport.offsetTop + index * rowHeight
      if (rowTop < viewport.scrollTop) element.scrollTop = rowTop
      else if (rowTop + rowHeight > viewport.scrollTop + viewport.clientHeight)
        element.scrollTop = rowTop + rowHeight - viewport.clientHeight
      else return
      update()
    },
    [count, measure, rowHeight, scrollElement, update],
  )

  const start = enabled ? Math.min(range.start, count) : 0
  const end = enabled ? Math.min(range.end, count) : count
  return {
    start,
    end,
    paddingTop: start * rowHeight,
    paddingBottom: (count - end) * rowHeight,
    scrollToIndex,
  }
}

export type { VirtualRowsOptions, VirtualRowsWindow }
export { computeRowRange, useVirtualRows }
