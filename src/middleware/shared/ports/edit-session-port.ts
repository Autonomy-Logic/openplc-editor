import { z } from 'zod'

/**
 * One project, one place (EDGE-652).
 *
 * Autonomy Edge saves a project by replacing the whole working tree, so a
 * project open in two places (two browser tabs, or the web and the desktop
 * editor) would silently overwrite itself: whichever copy saves last wins, and
 * a stale copy can even bring back files the other one deleted. Instead of
 * merging, each place registers an edit session when it opens a project and
 * keeps it alive with a heartbeat. When the user has the same project open in
 * more than one place, every place is told, saving is refused by the server,
 * and the user chooses which session to close.
 */

export type EditSessionClientKind = 'web' | 'desktop'

/** One of the user's other live sessions on the project, as the server reports it. */
export interface EditSessionSummary {
  id: string
  clientKind: EditSessionClientKind
  clientLabel: string
  /** ISO timestamp. */
  openedAt: string
  /** ISO timestamp. */
  lastSeenAt: string
}

export type EditSessionOpened =
  | {
      status: 'opened'
      sessionId: string
      otherSessions: EditSessionSummary[]
      heartbeatIntervalMs: number
    }
  /**
   * The session could not be opened: not signed in, offline, or a server that
   * does not have edit sessions yet. The editor carries on exactly as before,
   * and its saves go out without a session, so the server does not guard them.
   */
  | { status: 'unavailable' }

export type EditSessionBeat =
  | { status: 'active'; otherSessions: EditSessionSummary[] }
  /**
   * The session is closed. `byOtherSession` is true when the user closed it
   * from another place, which is the only case where editing must stop here.
   * False means this place released it itself (for example, a page restored
   * from the browser's back/forward cache): open a new session instead.
   */
  | { status: 'closed'; byOtherSession: boolean }
  /** The server no longer knows this session. Open a new one. */
  | { status: 'gone' }
  /** The question could not be asked (offline, timeout). Keep the last answer. */
  | { status: 'unknown' }

export interface EditSessionPort {
  /**
   * Registers this place as editing `projectId`. From then on the platform
   * attaches the session to every save of that project, so the server can
   * refuse a save while the project is open elsewhere.
   */
  open(projectId: string, client: { kind: EditSessionClientKind; label: string }): Promise<EditSessionOpened>

  heartbeat(projectId: string, sessionId: string): Promise<EditSessionBeat>

  /**
   * Closes a session. Without `closedBySessionId` the session is closing
   * itself, and the platform stops attaching it to saves. With it, the user is
   * closing another place from this one. Resolves to false when the server
   * could not be told.
   */
  close(projectId: string, sessionId: string, closedBySessionId?: string): Promise<boolean>

  /**
   * Best-effort release while the tab or window is going away: fire and
   * forget, safe to call from an unload handler. A release that never arrives
   * is cleaned up by the server's TTL.
   */
  release(projectId: string, sessionId: string): void
}

/**
 * Stable codes Autonomy Edge puts in a refused save. Matched by the platform
 * adapters to turn a 409 into a sentence the user can act on.
 */
export const PROJECT_EDIT_SESSION_CONFLICT = 'PROJECT_EDIT_SESSION_CONFLICT'
export const PROJECT_EDIT_SESSION_CLOSED = 'PROJECT_EDIT_SESSION_CLOSED'

export const EDIT_SESSION_CONFLICT_MESSAGE =
  'This project is open in more than one place. Close the other sessions to save it here.'
export const EDIT_SESSION_CLOSED_MESSAGE =
  'This editing session is no longer active, so the project was not saved here. Reopen the project to keep editing.'

/** Floor for the server's heartbeat interval: a bad value must not turn into a tight request loop. */
export const MIN_EDIT_SESSION_HEARTBEAT_INTERVAL_MS = 5_000

/** Maps a refused save's body to the message for the user, or null when it is not an edit-session refusal. */
export function editSessionRefusalMessage(status: number, body: string): string | null {
  if (status !== 409) {
    return null
  }
  if (body.includes(PROJECT_EDIT_SESSION_CONFLICT)) {
    return EDIT_SESSION_CONFLICT_MESSAGE
  }
  if (body.includes(PROJECT_EDIT_SESSION_CLOSED)) {
    return EDIT_SESSION_CLOSED_MESSAGE
  }
  return null
}

/** The header a save carries to name its edit session. */
export const EDIT_SESSION_HEADER = 'X-Edit-Session-Id'

// --- Wire schemas -----------------------------------------------------------
// Used by both adapters on the server's answer, and by the desktop renderer
// again on what arrives over IPC, where a TypeScript annotation proves nothing.

export const EditSessionSummarySchema = z.object({
  id: z.string().min(1),
  clientKind: z.enum(['web', 'desktop']),
  clientLabel: z.string(),
  openedAt: z.string(),
  lastSeenAt: z.string(),
}) satisfies z.ZodType<EditSessionSummary>

/** `POST /projects/:id/edit-sessions`, as Autonomy Edge answers it. */
export const EditSessionOpenResponseSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  otherSessions: z.array(EditSessionSummarySchema),
  heartbeatIntervalMs: z.number().int().positive(),
})

/** `POST /projects/:id/edit-sessions/:sessionId/heartbeat`, as Autonomy Edge answers it. */
export const EditSessionHeartbeatResponseSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), otherSessions: z.array(EditSessionSummarySchema) }),
  z.object({ status: z.literal('closed'), closedReason: z.string().nullish() }),
])

export const EditSessionOpenedSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('opened'),
    sessionId: z.string().min(1),
    otherSessions: z.array(EditSessionSummarySchema),
    heartbeatIntervalMs: z.number().int().positive(),
  }),
  z.object({ status: z.literal('unavailable') }),
]) satisfies z.ZodType<EditSessionOpened>

export const EditSessionBeatSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), otherSessions: z.array(EditSessionSummarySchema) }),
  z.object({ status: z.literal('closed'), byOtherSession: z.boolean() }),
  z.object({ status: z.literal('gone') }),
  z.object({ status: z.literal('unknown') }),
]) satisfies z.ZodType<EditSessionBeat>

/**
 * Turns the server's answers into port results. Shared so the web adapter and
 * the desktop main process read the server the same way.
 */
export function toEditSessionOpened(status: number, body: unknown): EditSessionOpened {
  if (status !== 201 && status !== 200) {
    return { status: 'unavailable' }
  }
  const parsed = EditSessionOpenResponseSchema.safeParse(unwrapData(body))
  if (!parsed.success) {
    return { status: 'unavailable' }
  }
  return {
    status: 'opened',
    sessionId: parsed.data.session.id,
    otherSessions: parsed.data.otherSessions,
    heartbeatIntervalMs: parsed.data.heartbeatIntervalMs,
  }
}

export function toEditSessionBeat(status: number, body: unknown): EditSessionBeat {
  if (status === 404) {
    return { status: 'gone' }
  }
  if (status !== 200) {
    return { status: 'unknown' }
  }
  const parsed = EditSessionHeartbeatResponseSchema.safeParse(unwrapData(body))
  if (!parsed.success) {
    return { status: 'unknown' }
  }
  return parsed.data.status === 'active'
    ? { status: 'active', otherSessions: parsed.data.otherSessions }
    : { status: 'closed', byOtherSession: parsed.data.closedReason === 'closed_by_other_session' }
}

/** Autonomy Edge wraps successful payloads as `{ data: ... }`; tolerate both shapes. */
function unwrapData(body: unknown): unknown {
  if (body !== null && typeof body === 'object' && 'data' in body) {
    return (body as { data: unknown }).data
  }
  return body
}

export function editSessionsPath(projectId: string, sessionId?: string, action?: 'heartbeat' | 'close'): string {
  const base = `/projects/${encodeURIComponent(projectId)}/edit-sessions`
  if (!sessionId) {
    return base
  }
  return action ? `${base}/${encodeURIComponent(sessionId)}/${action}` : `${base}/${encodeURIComponent(sessionId)}`
}
