import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type EditSessionPort,
  type EditSessionSummary,
  MIN_EDIT_SESSION_HEARTBEAT_INTERVAL_MS,
} from '../../middleware/shared/ports/edit-session-port'

const DEFAULT_INTERVAL_MS = 20_000

const OPEN_RETRY_MS = 30_000
const MAX_OPEN_RETRY_MS = 5 * 60_000

export type ProjectEditSessionState =
  | { phase: 'idle' }
  | { phase: 'active'; sessionId: string; otherSessions: EditSessionSummary[] }
  | { phase: 'closed-elsewhere'; sessionId: string }

export interface UseProjectEditSessionArgs {
  port: EditSessionPort | undefined
  projectId: string | null
  client: { kind: 'web' | 'desktop'; label: string }
}

export interface UseProjectEditSessionResult {
  state: ProjectEditSessionState
  closeOtherSession(sessionId: string): Promise<boolean>
  closeThisSession(): Promise<boolean>
}

export function useProjectEditSession({
  port,
  projectId,
  client,
}: UseProjectEditSessionArgs): UseProjectEditSessionResult {
  const [state, setState] = useState<ProjectEditSessionState>({ phase: 'idle' })
  const sessionRef = useRef<string | null>(null)
  const beatNowRef = useRef<() => void>(() => undefined)

  const { kind, label } = client

  useEffect(() => {
    setState({ phase: 'idle' })
    if (!port || !projectId) {
      return
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let intervalMs = DEFAULT_INTERVAL_MS
    let sessionId: string | null = null
    let stopped = false
    let generation = 0
    let opening = false
    let retryMs = OPEN_RETRY_MS

    const clearTimer = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const schedule = (next: () => Promise<void>, delayMs: number) => {
      clearTimer()
      if (!disposed && !stopped) {
        timer = setTimeout(() => void next(), delayMs)
      }
    }

    const open = async () => {
      if (opening || disposed || stopped) {
        return
      }
      opening = true
      const mine = ++generation
      const opened = await port.open(projectId, { kind, label }).finally(() => {
        opening = false
      })
      if (disposed) {
        if (opened.status === 'opened') {
          port.release(projectId, opened.sessionId)
        }
        return
      }
      if (mine !== generation) {
        if (opened.status === 'opened') {
          void port.close(projectId, opened.sessionId)
        }
        return
      }
      if (opened.status !== 'opened') {
        sessionId = null
        sessionRef.current = null
        setState({ phase: 'idle' })
        if (!opened.permanent) {
          schedule(open, retryMs)
          retryMs = Math.min(retryMs * 2, MAX_OPEN_RETRY_MS)
        }
        return
      }
      retryMs = OPEN_RETRY_MS
      sessionId = opened.sessionId
      sessionRef.current = opened.sessionId
      intervalMs = Math.max(opened.heartbeatIntervalMs, MIN_EDIT_SESSION_HEARTBEAT_INTERVAL_MS)
      setState({ phase: 'active', sessionId: opened.sessionId, otherSessions: opened.otherSessions })
      schedule(beat, intervalMs)
    }

    const beat = async () => {
      if (disposed || stopped) {
        return
      }
      if (!sessionId) {
        await open()
        return
      }
      const current = sessionId
      const mine = ++generation
      const result = await port.heartbeat(projectId, current)
      if (disposed || mine !== generation || current !== sessionId) {
        return
      }
      switch (result.status) {
        case 'active':
          setState({ phase: 'active', sessionId: current, otherSessions: result.otherSessions })
          schedule(beat, intervalMs)
          return
        case 'closed':
          if (result.byOtherSession) {
            stopped = true
            clearTimer()
            setState({ phase: 'closed-elsewhere', sessionId: current })
            return
          }
          sessionId = null
          sessionRef.current = null
          await open()
          return
        case 'gone':
          sessionId = null
          sessionRef.current = null
          await open()
          return
        case 'unknown':
          schedule(beat, intervalMs)
          return
        default: {
          const unreachable: never = result
          return unreachable
        }
      }
    }

    beatNowRef.current = () => {
      clearTimer()
      void beat()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        beatNowRef.current()
      }
    }

    const onPageHide = (event: PageTransitionEvent) => {
      if (!event.persisted && sessionId) {
        port.release(projectId, sessionId)
        sessionId = null
      }
    }

    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)
    void open()

    return () => {
      disposed = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      beatNowRef.current = () => undefined
      if (sessionId && sessionRef.current === sessionId) {
        port.release(projectId, sessionId)
      }
      sessionRef.current = null
    }
  }, [port, projectId, kind, label])

  const closeOtherSession = useCallback(
    async (otherSessionId: string) => {
      const current = sessionRef.current
      if (!port || !projectId || !current) {
        return false
      }
      const closed = await port.close(projectId, otherSessionId, current)
      beatNowRef.current()
      return closed
    },
    [port, projectId],
  )

  const closeThisSession = useCallback(async () => {
    const current = sessionRef.current
    if (!port || !projectId || !current) {
      return false
    }
    const closed = await port.close(projectId, current)
    if (closed) {
      sessionRef.current = null
    }
    return closed
  }, [port, projectId])

  return { state, closeOtherSession, closeThisSession }
}
