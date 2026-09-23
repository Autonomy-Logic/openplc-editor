import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { act, renderHook, waitFor } from '@testing-library/react'

import type {
  EditSessionBeat,
  EditSessionOpened,
  EditSessionPort,
  EditSessionSummary,
} from '../../../middleware/shared/ports/edit-session-port'
import { useProjectEditSession } from '../use-project-edit-session'

const CLIENT = { kind: 'web' as const, label: 'Chrome on macOS' }

const desktop: EditSessionSummary = {
  id: 'desktop-session',
  clientKind: 'desktop',
  clientLabel: 'OpenPLC Editor on Windows',
  openedAt: '2026-09-23T12:00:00.000Z',
  lastSeenAt: '2026-09-23T12:00:00.000Z',
}

function makePort(
  opened: EditSessionOpened = { status: 'opened', sessionId: 'mine', otherSessions: [], heartbeatIntervalMs: 20_000 },
) {
  const beats: EditSessionBeat[] = []
  const port = {
    open: jest.fn((_projectId: string, _client: { kind: 'web' | 'desktop'; label: string }) => Promise.resolve(opened)),
    heartbeat: jest.fn((_projectId: string, _sessionId: string) =>
      Promise.resolve(beats.shift() ?? ({ status: 'active', otherSessions: [] } as EditSessionBeat)),
    ),
    close: jest.fn((_projectId: string, _sessionId: string, _by?: string) => Promise.resolve(true)),
    release: jest.fn((_projectId: string, _sessionId: string) => undefined),
  } satisfies EditSessionPort
  return { port, beats }
}

describe('useProjectEditSession', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('stays idle, and opens nothing, when there is no cloud project to guard', () => {
    const { port } = makePort()
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: null, client: CLIENT }))

    expect(result.current.state).toEqual({ phase: 'idle' })
    expect(port.open).not.toHaveBeenCalled()
  })

  it('stays idle when the server has no edit sessions, so the editor works as before', async () => {
    const { port } = makePort({ status: 'unavailable' })
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))

    await waitFor(() => expect(port.open).toHaveBeenCalledWith('p1', CLIENT))
    expect(result.current.state).toEqual({ phase: 'idle' })
  })

  it('reports at once the session that was already open elsewhere', async () => {
    const { port } = makePort({
      status: 'opened',
      sessionId: 'mine',
      otherSessions: [desktop],
      heartbeatIntervalMs: 20_000,
    })
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))

    await waitFor(() =>
      expect(result.current.state).toEqual({ phase: 'active', sessionId: 'mine', otherSessions: [desktop] }),
    )
  })

  it('learns on a heartbeat that the project was opened somewhere else', async () => {
    const { port, beats } = makePort()
    beats.push({ status: 'active', otherSessions: [desktop] })
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(20_000)
    })

    await waitFor(() => expect(port.heartbeat).toHaveBeenCalledWith('p1', 'mine'))
    await waitFor(() =>
      expect(result.current.state).toEqual({ phase: 'active', sessionId: 'mine', otherSessions: [desktop] }),
    )
  })

  it('stops, and says so, when the user closed this session from another place', async () => {
    const { port, beats } = makePort()
    beats.push({ status: 'closed', byOtherSession: true })
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(20_000)
    })
    await waitFor(() => expect(result.current.state).toEqual({ phase: 'closed-elsewhere', sessionId: 'mine' }))

    // No more heartbeats after that.
    const beatsSoFar = port.heartbeat.mock.calls.length
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(60_000)
    })
    expect(port.heartbeat.mock.calls.length).toBe(beatsSoFar)
  })

  it('takes a new session when the server forgot this one, rather than edit unguarded', async () => {
    const { port, beats } = makePort()
    beats.push({ status: 'gone' })
    renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(port.open).toHaveBeenCalledTimes(1))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(20_000)
    })

    await waitFor(() => expect(port.open).toHaveBeenCalledTimes(2))
  })

  it('closes another session from this one, then refreshes the list at once', async () => {
    const { port } = makePort({
      status: 'opened',
      sessionId: 'mine',
      otherSessions: [desktop],
      heartbeatIntervalMs: 20_000,
    })
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    await act(async () => {
      await result.current.closeOtherSession('desktop-session')
    })

    expect(port.close).toHaveBeenCalledWith('p1', 'desktop-session', 'mine')
    await waitFor(() => expect(port.heartbeat).toHaveBeenCalled())
    await waitFor(() => expect(result.current.state).toEqual({ phase: 'active', sessionId: 'mine', otherSessions: [] }))
  })

  it('releases its session when the project closes', async () => {
    const { port } = makePort()
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string | null }) => useProjectEditSession({ port, projectId, client: CLIENT }),
      { initialProps: { projectId: 'p1' as string | null } },
    )
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    rerender({ projectId: null })

    // `release`: leaving the project can navigate the page away, and a plain request would be cancelled.
    expect(port.release).toHaveBeenCalledWith('p1', 'mine')
    expect(result.current.state).toEqual({ phase: 'idle' })
  })

  it('reopens, instead of showing "closed elsewhere", when this place released the session itself', async () => {
    const { port, beats } = makePort()
    beats.push({ status: 'closed', byOtherSession: false })
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(port.open).toHaveBeenCalledTimes(1))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(20_000)
    })

    await waitFor(() => expect(port.open).toHaveBeenCalledTimes(2))
    expect(result.current.state.phase).toBe('active')
  })

  it('keeps the session when the page only goes into the back/forward cache', async () => {
    const { port } = makePort()
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    const cached = new Event('pagehide')
    Object.defineProperty(cached, 'persisted', { value: true })
    window.dispatchEvent(cached)

    expect(port.release).not.toHaveBeenCalled()
  })

  it('drops the answer of an older heartbeat that lands after a newer one', async () => {
    const { port } = makePort()
    let answerSlow: (beat: EditSessionBeat) => void = () => undefined
    port.heartbeat
      .mockImplementationOnce(() => new Promise<EditSessionBeat>((resolve) => (answerSlow = resolve)))
      .mockImplementationOnce(() => Promise.resolve({ status: 'active', otherSessions: [] }))
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    // Slow beat starts, then the user closes another place, which beats again at once.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(20_000)
    })
    await act(async () => {
      await result.current.closeOtherSession('desktop-session')
    })
    await waitFor(() => expect(port.heartbeat).toHaveBeenCalledTimes(2))
    // The slow answer still lists the closed place; it must not come back on screen.
    await act(async () => {
      answerSlow({ status: 'active', otherSessions: [desktop] })
    })

    expect(result.current.state).toEqual({ phase: 'active', sessionId: 'mine', otherSessions: [] })
  })

  it('tries again later when the session could not be opened', async () => {
    const { port } = makePort({ status: 'unavailable' })
    renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(port.open).toHaveBeenCalledTimes(1))

    await act(async () => {
      await jest.advanceTimersByTimeAsync(0)
      await jest.advanceTimersByTimeAsync(30_000)
    })

    await waitFor(() => expect(port.open).toHaveBeenCalledTimes(2))
  })

  it('releases its session when the page goes away', async () => {
    const { port } = makePort()
    const { result } = renderHook(() => useProjectEditSession({ port, projectId: 'p1', client: CLIENT }))
    await waitFor(() => expect(result.current.state.phase).toBe('active'))

    window.dispatchEvent(new Event('pagehide'))

    expect(port.release).toHaveBeenCalledWith('p1', 'mine')
  })
})
