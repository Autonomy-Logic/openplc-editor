import { act, render } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

import { type StickToBottomHandle, useStickToBottom } from '../use-stick-to-bottom'

/**
 * jsdom has no layout: `scrollHeight` / `clientHeight` are always 0 and
 * `scrollTop` is a plain number that never clamps. Give the container a
 * scriptable geometry, including the clamp a real scroller applies to
 * `scrollTop`, so the tests can model a growing transcript.
 */
function giveGeometry(el: HTMLElement, { scrollHeight, clientHeight }: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true })
}

function installClampingScrollTop(el: HTMLElement) {
  let top = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = Math.max(0, Math.min(value, el.scrollHeight - el.clientHeight))
    },
  })
}

const CLIENT_HEIGHT = 500

interface Harness {
  handle: StickToBottomHandle
  container: HTMLDivElement
  /** Grow the transcript without touching scrollTop, as a stream does. */
  grow: (by: number) => void
  /** Dispatch the scroll event the browser emits a frame *after* a move. */
  emitScroll: () => void
  gap: () => number
}

function renderHarness({ active = false }: { active?: boolean } = {}): Harness {
  const captured: { handle?: StickToBottomHandle; container?: HTMLDivElement } = {}
  let scrollHeight = CLIENT_HEIGHT

  function Probe() {
    const handle = useStickToBottom(active)
    captured.handle = handle
    useEffect(() => {
      captured.container = handle.containerRef.current ?? undefined
    })
    return (
      // `tabIndex` mirrors the panel (ai-chat-panel.tsx): the scroller has to
      // be focusable for the keyboard handlers to receive anything.
      <div ref={handle.containerRef} tabIndex={0} data-testid='scroller'>
        <div ref={handle.contentRef}>content</div>
      </div>
    )
  }

  // Query inside this render's own root: several tests mount two harnesses,
  // and a document-wide lookup would match both.
  const { container: root } = render(<Probe />)
  const container = root.querySelector<HTMLDivElement>('[data-testid="scroller"]')
  if (!container) throw new Error('scroller did not render')
  giveGeometry(container, { scrollHeight, clientHeight: CLIENT_HEIGHT })
  installClampingScrollTop(container)

  return {
    get handle() {
      if (!captured.handle) throw new Error('hook did not render')
      return captured.handle
    },
    container,
    grow: (by: number) => {
      scrollHeight += by
      giveGeometry(container, { scrollHeight, clientHeight: CLIENT_HEIGHT })
    },
    emitScroll: () => {
      act(() => {
        container.dispatchEvent(new Event('scroll'))
      })
    },
    gap: () => container.scrollHeight - container.scrollTop - container.clientHeight,
  }
}

describe('useStickToBottom', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('starts attached and pins to the tail', () => {
    const h = renderHarness()
    h.grow(1500)
    act(() => h.handle.pin())
    expect(h.container.scrollTop).toBe(2000 - CLIENT_HEIGHT)
    expect(h.gap()).toBe(0)
    expect(h.handle.isFollowing()).toBe(true)
  })

  // The regression this whole hook exists for.
  it('does not detach when its own pin is followed by a late scroll event', () => {
    const h = renderHarness()
    h.grow(1500)
    act(() => h.handle.pin())

    // The browser delivers the scroll event a frame later — by which time the
    // stream has appended more content, so the geometry read back is stale
    // and shows a large gap. That must NOT be read as a user scroll-up.
    h.grow(900)
    h.emitScroll()

    expect(h.handle.isFollowing()).toBe(true)
    act(() => h.handle.pin())
    expect(h.gap()).toBe(0)
  })

  it('detaches synchronously on a wheel-up, before any pin can race it', () => {
    const h = renderHarness()
    h.grow(1500)
    act(() => h.handle.pin())

    act(() => {
      h.container.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    })
    expect(h.handle.isFollowing()).toBe(false)

    // Further growth must leave the view exactly where the user put it.
    const parked = (h.container.scrollTop -= 600)
    h.grow(800)
    act(() => h.handle.pin())
    expect(h.container.scrollTop).toBe(parked)
  })

  it('keeps following on a wheel-down', () => {
    const h = renderHarness()
    act(() => {
      h.container.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    })
    expect(h.handle.isFollowing()).toBe(true)
  })

  it('re-attaches when the user scrolls back to the bottom', () => {
    const h = renderHarness()
    h.grow(1500)
    act(() => {
      h.container.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    })
    h.container.scrollTop = 400
    h.emitScroll()
    expect(h.handle.isFollowing()).toBe(false)

    // Back to the bottom, under the slack threshold.
    act(() => {
      h.container.dispatchEvent(new WheelEvent('wheel', { deltaY: 120 }))
    })
    h.container.scrollTop = h.container.scrollHeight - CLIENT_HEIGHT - 1
    h.emitScroll()
    expect(h.handle.isFollowing()).toBe(true)
  })

  it('followTail re-engages after a detach and jumps to the tail', () => {
    const h = renderHarness()
    h.grow(1500)
    act(() => {
      h.container.dispatchEvent(new WheelEvent('wheel', { deltaY: -120 }))
    })
    h.container.scrollTop = 200
    expect(h.handle.isFollowing()).toBe(false)

    act(() => h.handle.followTail())

    expect(h.handle.isFollowing()).toBe(true)
    expect(h.gap()).toBe(0)
  })

  it('detaches on a downward touch drag but not an upward one', () => {
    const down = renderHarness()
    const touchAt = (el: HTMLElement, type: string, clientY: number) =>
      act(() => {
        const event = new Event(type, { bubbles: true }) as Event & { touches: Array<{ clientY: number }> }
        Object.defineProperty(event, 'touches', { value: [{ clientY }] })
        el.dispatchEvent(event)
      })

    touchAt(down.container, 'touchstart', 100)
    touchAt(down.container, 'touchmove', 260) // finger down => content scrolls up
    expect(down.handle.isFollowing()).toBe(false)

    const up = renderHarness()
    touchAt(up.container, 'touchstart', 260)
    touchAt(up.container, 'touchmove', 100)
    expect(up.handle.isFollowing()).toBe(true)
  })

  it.each(['PageUp', 'Home', 'ArrowUp'])('detaches on %s', (key) => {
    const h = renderHarness()
    // Dispatched from the focused container, not at it: `keydown` reaches the
    // scroller by bubbling up from whatever has focus, so a test that fires
    // directly on the container would pass even if the panel gave it no way to
    // take focus. The panel sets `tabIndex={0}` for exactly this reason.
    h.container.focus()
    expect(document.activeElement).toBe(h.container)
    act(() => {
      document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
    })
    expect(h.handle.isFollowing()).toBe(false)
  })

  it('keeps following on a key that does not scroll up', () => {
    const h = renderHarness()
    act(() => {
      h.container.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' }))
    })
    expect(h.handle.isFollowing()).toBe(true)
  })

  it('suppresses pinning during a scrollbar drag and settles on release', () => {
    const h = renderHarness()
    h.grow(1500)
    act(() => {
      h.container.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })

    h.container.scrollTop = 300
    act(() => h.handle.pin())
    expect(h.container.scrollTop).toBe(300) // the drag was not fought

    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })
    expect(h.handle.isFollowing()).toBe(false) // released far from the bottom

    // Releasing at the bottom re-attaches instead.
    const h2 = renderHarness()
    h2.grow(1500)
    act(() => {
      h2.container.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    })
    h2.container.scrollTop = h2.container.scrollHeight - CLIENT_HEIGHT
    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })
    expect(h2.handle.isFollowing()).toBe(true)
  })

  it('ignores a pointerup that follows no drag on the scroller', () => {
    const h = renderHarness()
    h.grow(1500)
    h.container.scrollTop = 0
    act(() => {
      window.dispatchEvent(new Event('pointerup'))
    })
    // Clicking elsewhere on the page must not change attachment.
    expect(h.handle.isFollowing()).toBe(true)
  })

  it('re-asserts the tail every frame while a turn is active', () => {
    const frames: FrameRequestCallback[] = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      frames.push(cb)
      return frames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)

    const h = renderHarness({ active: true })
    // Content grows with no React render at all — only the frame loop can
    // catch this, which is the case a render-driven pin slid behind on.
    h.grow(1200)
    act(() => frames[frames.length - 1](0))

    expect(h.gap()).toBe(0)
  })

  it('does not run the frame loop when no turn is active', () => {
    const raf = vi.spyOn(window, 'requestAnimationFrame')
    renderHarness({ active: false })
    expect(raf).not.toHaveBeenCalled()
  })

  it('re-pins when the content box resizes', () => {
    const observers: Array<() => void> = []
    class RO {
      constructor(private cb: () => void) {
        observers.push(() => this.cb())
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    // Assigned rather than stubbed: `stubGlobal` is a Vitest-only API and this
    // file also runs under Jest too, so the swap is done by hand and undone in
    // `finally` — otherwise a failing assertion would leak this stub into every
    // later test in the process.
    const scope = globalThis as { ResizeObserver?: unknown }
    const previousResizeObserver = scope.ResizeObserver
    scope.ResizeObserver = RO
    try {
      const h = renderHarness()
      h.grow(1500)
      act(() => observers[0]())

      expect(h.gap()).toBe(0)
    } finally {
      scope.ResizeObserver = previousResizeObserver
    }
  })
})
