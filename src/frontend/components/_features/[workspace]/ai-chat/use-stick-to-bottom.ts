import { type RefObject, useCallback, useEffect, useRef } from 'react'

/** Pixel slack for the "scrolled to bottom" check — sub-pixel layout can leave a 0.5-1.5px gap even at the bottom. */
export const STICK_THRESHOLD_PX = 4

export interface StickToBottomHandle {
  /** Attach to the scrolling element. */
  containerRef: RefObject<HTMLDivElement>
  /** Attach to the element that grows inside the scroller. A callback ref, since it mounts late. */
  contentRef: (node: HTMLDivElement | null) => void
  /** Pin to the tail if auto-follow is currently engaged. */
  pin: () => void
  /** Re-engage auto-follow regardless of where the view sits. */
  followTail: () => void
  /** Test/diagnostic read of the current attachment state. */
  isFollowing: () => boolean
}

/**
 * VSCode-console-style sticky bottom for a streaming transcript. Follow state is decided by user
 * gesture (detach happens synchronously in the gesture handlers), not by geometry sampled from
 * async `scroll` events, which lag behind streamed content and would cause false detaches.
 */
export function useStickToBottom(active: boolean): StickToBottomHandle {
  const containerRef = useRef<HTMLDivElement>(null)
  const contentObserverRef = useRef<ResizeObserver | null>(null)

  /**
   * A ref, not state: the pin itself fires scroll events that re-evaluate
   * this, so state would re-render on every scroll.
   */
  const followingRef = useRef(true)
  /** A user gesture is driving the scroll currently in flight. */
  const userScrollRef = useRef(false)
  /** Scrollbar drag in progress — suppress pinning until the button is up. */
  const pointerDownRef = useRef(false)
  /** Last touch Y, to tell a drag-down (scroll up) from a drag-up. */
  const touchYRef = useRef<number | null>(null)

  const pin = useCallback(() => {
    const container = containerRef.current
    // Never fight a scrollbar drag in progress.
    if (!container || pointerDownRef.current || !followingRef.current) return
    container.scrollTop = container.scrollHeight
  }, [])

  const followTail = useCallback(() => {
    followingRef.current = true
    pin()
  }, [pin])

  const isFollowing = useCallback(() => followingRef.current, [])

  // Gesture + scroll listeners. The container element is stable across
  // renders, so this binds once.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const settleFromGeometry = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      followingRef.current = scrollHeight - scrollTop - clientHeight < STICK_THRESHOLD_PX
    }

    const handleWheel = (event: WheelEvent) => {
      userScrollRef.current = true
      if (event.deltaY < 0) followingRef.current = false
    }
    const handleTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null
    }
    const handleTouchMove = (event: TouchEvent) => {
      userScrollRef.current = true
      const y = event.touches[0]?.clientY ?? null
      // A finger moving down drags the content down, i.e. scrolls up.
      if (y !== null && touchYRef.current !== null && y > touchYRef.current) followingRef.current = false
      touchYRef.current = y
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      userScrollRef.current = true
      if (event.key === 'PageUp' || event.key === 'Home' || event.key === 'ArrowUp') followingRef.current = false
    }
    const handlePointerDown = () => {
      pointerDownRef.current = true
    }
    const handlePointerUp = () => {
      if (!pointerDownRef.current) return
      pointerDownRef.current = false
      // Settle on the position the drag finished at.
      settleFromGeometry()
    }
    const handleScroll = () => {
      // Re-attach only; detaching is the gesture handlers' job.
      if (followingRef.current) return
      if (!userScrollRef.current && !pointerDownRef.current) return
      // A drag keeps producing scrolls until the button is released; a wheel
      // or key press re-marks itself on every repeat, so consume the flag.
      if (!pointerDownRef.current) userScrollRef.current = false
      settleFromGeometry()
    }

    // Passive — we never preventDefault on these, and the browser emits them
    // in a hot loop during fling-scroll.
    container.addEventListener('scroll', handleScroll, { passive: true })
    container.addEventListener('wheel', handleWheel, { passive: true })
    container.addEventListener('touchstart', handleTouchStart, { passive: true })
    container.addEventListener('touchmove', handleTouchMove, { passive: true })
    container.addEventListener('keydown', handleKeyDown)
    container.addEventListener('pointerdown', handlePointerDown)
    // On window: the pointer is routinely released outside the scrollbar.
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerUp)

    return () => {
      container.removeEventListener('scroll', handleScroll)
      container.removeEventListener('wheel', handleWheel)
      container.removeEventListener('touchstart', handleTouchStart)
      container.removeEventListener('touchmove', handleTouchMove)
      container.removeEventListener('keydown', handleKeyDown)
      container.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerUp)
    }
  }, [])

  // Hold the tail every frame while a turn is in flight.
  useEffect(() => {
    if (!active) return
    let frame = 0
    const tick = () => {
      pin()
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [active, pin])

  // Content can also settle outside a turn (a late reflow after the last
  // token, an image decoding); re-pin on the content box itself.
  const contentRef = useCallback(
    (node: HTMLDivElement | null) => {
      contentObserverRef.current?.disconnect()
      contentObserverRef.current = null
      if (!node) return
      const observer = new ResizeObserver(() => pin())
      observer.observe(node)
      contentObserverRef.current = observer
    },
    [pin],
  )

  useEffect(() => () => contentObserverRef.current?.disconnect(), [])

  return { containerRef, contentRef, pin, followTail, isFollowing }
}
