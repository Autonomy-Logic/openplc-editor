import { memo, useEffect, useLayoutEffect, useMemo, useRef } from 'react'

import { useNavigateToCompileError } from '../../../hooks/use-navigate-to-compile-error'
import { useOpenPLCStore } from '../../../store'
import formatTimestamp from '../../../utils/format-timestamp'
import { LogComponent } from './log'

/**
 * Pixel slack for the "scrolled to bottom" check.  Sub-pixel layout
 * (fractional `scrollTop` on hi-DPI displays, `clientHeight` rounding)
 * can leave `scrollHeight - scrollTop - clientHeight` at 0.5–1.5 px
 * even when the user is visually at the bottom.  Anything tighter
 * than this and we detach from auto-scroll on a phantom delta.  Wider
 * than this and a real one-line scroll-up wouldn't detach.
 */
const STICK_THRESHOLD_PX = 4

const Console = memo(() => {
  const logs = useOpenPLCStore((state) => state.logs)
  const filters = useOpenPLCStore((state) => state.filters)
  const followRequestId = useOpenPLCStore((state) => state.followRequestId)
  const navigateToCompileError = useNavigateToCompileError()
  const containerRef = useRef<HTMLDivElement | null>(null)

  /**
   * Auto-scroll attachment state — VSCode-style sticky bottom.
   *
   * - `true`: console is following the tail.  Every new message
   *   triggers an immediate scroll-to-bottom (no debounce).
   * - `false`: user scrolled up to read; new messages append silently.
   *   Re-attaches the instant the user manually scrolls back to the
   *   bottom (the scroll listener flips this back to `true`).
   *
   * Starts `true` so the first batch of logs lands at the bottom.
   * Stored as a ref because the auto-scroll write itself fires
   * scroll events that re-evaluate this — a state update would
   * cause a re-render loop with every scroll.
   */
  const stickToBottomRef = useRef(true)

  // Apply filters to logs
  const filteredLogs = useMemo(() => {
    return logs.filter((log) => {
      // Filter by level
      const level = log.level || 'info'
      if (!filters.levels[level]) return false

      // Filter by search term
      if (filters.searchTerm) {
        const searchLower = filters.searchTerm.toLowerCase()
        const messageMatch = log.message.toLowerCase().includes(searchLower)
        const timestampMatch = log.tstamp?.toISOString().includes(searchLower) ?? false
        if (!messageMatch && !timestampMatch) return false
      }

      return true
    })
  }, [logs, filters])

  /**
   * Scroll listener — updates the stick flag whenever the user (or
   * the auto-scroll layout effect below) changes `scrollTop`.
   *
   * Programmatic scrolls fired by the layout effect land at the
   * bottom, so they keep stick=true.  User scroll-up moves stick to
   * false; user scroll-back-to-bottom moves it back to true.
   */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      stickToBottomRef.current = scrollHeight - scrollTop - clientHeight < STICK_THRESHOLD_PX
    }

    // Passive — we never preventDefault on scroll, and the browser
    // emits these in a hot loop during fling-scroll.
    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [])

  /**
   * Auto-scroll on new content.  `useLayoutEffect` (not `useEffect`)
   * so the scroll happens synchronously after the DOM mutation and
   * before paint — the user never sees the old scroll position flash
   * while the auto-scroll is "catching up."  No debounce: high-rate
   * log bursts (compile output, debugger ticks) need to pop to the
   * end as fast as they arrive, not 75 ms later.
   *
   * Setting `scrollTop = scrollHeight` is the direct, no-surprise
   * write — `scrollIntoView({behavior: 'instant'})` is non-standard
   * and silently falls back to smooth-scroll on some browsers, which
   * is exactly the lag the previous implementation had.
   */
  useLayoutEffect(() => {
    if (!stickToBottomRef.current) return
    const container = containerRef.current
    if (!container) return
    container.scrollTop = container.scrollHeight
  }, [filteredLogs])

  /**
   * One-shot "kick to bottom" requested externally (e.g. a build starting).
   * Unlike the auto-scroll above, this re-engages auto-follow and scrolls to
   * the latest line regardless of the current scroll position — so a build
   * that starts while the user has scrolled up still snaps to the tail and
   * keeps following. The rAF re-assert covers the case where the console panel
   * is being revealed on this same tick (its height isn't final until after
   * this layout pass). `followRequestId` starts at 0, so the initial mount is
   * skipped and we never force-scroll unprompted.
   */
  useLayoutEffect(() => {
    if (followRequestId === 0) return
    stickToBottomRef.current = true
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
    const raf = requestAnimationFrame(() => {
      const c = containerRef.current
      if (c && stickToBottomRef.current) c.scrollTop = c.scrollHeight
    })
    return () => cancelAnimationFrame(raf)
  }, [followRequestId])

  return (
    <div
      ref={containerRef}
      aria-label='Console'
      className='relative h-full w-full select-text overflow-auto text-cp-base font-semibold text-brand-dark focus:outline-none dark:text-neutral-50'
    >
      {filteredLogs.length > 0 &&
        filteredLogs.map((log) => (
          <LogComponent
            key={log.id}
            level={log.level}
            message={log.message}
            tstamp={formatTimestamp(log.tstamp ?? new Date(), filters.timestampFormat)}
            searchTerm={filters.searchTerm}
            compileError={log.compileError}
            onCompileErrorClick={navigateToCompileError}
          />
        ))}
    </div>
  )
})

export { Console }
