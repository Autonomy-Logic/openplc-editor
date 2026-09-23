import { useCallback, useEffect, useRef, useState } from 'react'

import {
  type EditSessionPort,
  type EditSessionSummary,
  MIN_EDIT_SESSION_HEARTBEAT_INTERVAL_MS,
} from '../../middleware/shared/ports/edit-session-port'

/**
 * Keeps this place's edit session on a cloud project (EDGE-652).
 *
 * Opens a session when an editable cloud project is open, beats while it
 * stays open, and releases it when the project closes or the page goes away.
 * The server answers every beat with the user's other live sessions on the
 * project, which is how both places find out about each other.
 */

/** Used until the server says otherwise. */
const DEFAULT_INTERVAL_MS = 20_000

/** How long to wait before trying again when a session could not be opened. */
const OPEN_RETRY_MS = 30_000

export type ProjectEditSessionState =
  /** No guard: not a cloud project, read-only, or the server has no edit sessions. */
  | { phase: 'idle' }
  | { phase: 'active'; sessionId: string; otherSessions: EditSessionSummary[] }
  /** The user closed this session from another place. Editing here must stop. */
  | { phase: 'closed-elsewhere'; sessionId: string }

export interface UseProjectEditSessionArgs {
  port: EditSessionPort | undefined
  /** The cloud project id, or null when the open project is not one this guard applies to. */
  projectId: string | null
  client: { kind: 'web' | 'desktop'; label: string }
}

export interface UseProjectEditSessionResult {
  state: ProjectEditSessionState
  /** Closes another of the user's sessions from this one. Resolves to false when the server could not be told. */
  closeOtherSession(sessionId: string): Promise<boolean>
  /** Releases this session. The caller then leaves the project. */
  closeThisSession(): Promise<void>
}

export function useProjectEditSession({
  port,
  projectId,
  client,
}: UseProjectEditSessionArgs): UseProjectEditSessionResult {
  const [state, setState] = useState<ProjectEditSessionState>({ phase: 'idle' })
  // Read by the actions below without re-subscribing the effect.
  const sessionRef = useRef<string | null>(null)
  const beatNowRef = useRef<() => void>(() => undefined)

  const { kind, label } = client

  useEffect(() => {
    if (!port || !projectId) {
      setState({ phase: 'idle' })
      return
    }

    let disposed = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let intervalMs = DEFAULT_INTERVAL_MS
    let sessionId: string | null = null
    let stopped = false
    // Every request is stamped with the generation it started in; an answer
    // from an older generation is dropped. Without this, a slow heartbeat that
    // started before the user closed another place can land afterwards and put
    // the closed place back on screen.
    let generation = 0
    let opening = false

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
        // Offline, signed out, or a server without edit sessions: try again
        // later rather than run the whole visit unguarded.
        schedule(open, OPEN_RETRY_MS)
        return
      }
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
          // This place released it itself (a page restored from the
          // back/forward cache): take a new one.
          sessionId = null
          sessionRef.current = null
          await open()
          return
        case 'gone':
          // The server forgot this session; take a new one rather than edit unguarded.
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

    // A hidden tab's timers are throttled; answer from fresh data the moment the user looks at it.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        beatNowRef.current()
      }
    }

    // A page going into the back/forward cache is not going away: keep the
    // session, and let the next beat decide whether it still stands.
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
      if (sessionId) {
        // `release`, not `close`: leaving the project can navigate the page
        // away (web), and a plain request would be cancelled with it. Idempotent
        // on the server, and it also stops the platform attaching the id to saves.
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
      // Refresh the list at once instead of waiting for the next beat.
      beatNowRef.current()
      return closed
    },
    [port, projectId],
  )

  const closeThisSession = useCallback(async () => {
    const current = sessionRef.current
    if (!port || !projectId || !current) {
      return
    }
    sessionRef.current = null
    await port.close(projectId, current)
  }, [port, projectId])

  return { state, closeOtherSession, closeThisSession }
}
