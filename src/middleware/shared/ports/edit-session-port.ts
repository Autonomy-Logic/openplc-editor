import { z } from 'zod'

export type EditSessionClientKind = 'web' | 'desktop'

export interface EditSessionSummary {
  id: string
  clientKind: EditSessionClientKind
  clientLabel: string
  openedAt: string
  lastSeenAt: string
}

export type EditSessionOpened =
  | {
      status: 'opened'
      sessionId: string
      otherSessions: EditSessionSummary[]
      heartbeatIntervalMs: number
    }
  | { status: 'unavailable'; permanent: boolean }

export type EditSessionBeat =
  | { status: 'active'; otherSessions: EditSessionSummary[] }
  | { status: 'closed'; byOtherSession: boolean }
  | { status: 'gone' }
  | { status: 'unknown' }

export interface EditSessionPort {
  open(projectId: string, client: { kind: EditSessionClientKind; label: string }): Promise<EditSessionOpened>

  heartbeat(projectId: string, sessionId: string): Promise<EditSessionBeat>

  close(projectId: string, sessionId: string, closedBySessionId?: string): Promise<boolean>

  release(projectId: string, sessionId: string): void
}

export const PROJECT_EDIT_SESSION_CONFLICT = 'PROJECT_EDIT_SESSION_CONFLICT'
export const PROJECT_EDIT_SESSION_CLOSED = 'PROJECT_EDIT_SESSION_CLOSED'

export const EDIT_SESSION_CONFLICT_MESSAGE =
  'This project is open in more than one place. Close the other sessions to save it here.'
export const EDIT_SESSION_CLOSED_MESSAGE =
  'This editing session is no longer active, so the project was not saved here. Reopen the project to keep editing.'

export const MIN_EDIT_SESSION_HEARTBEAT_INTERVAL_MS = 5_000

const RefusalBodySchema = z.object({ error: z.object({ code: z.string() }) })

export function editSessionRefusalMessage(status: number, body: string): string | null {
  if (status !== 409) {
    return null
  }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    return null
  }
  const parsed = RefusalBodySchema.safeParse(json)
  if (!parsed.success) {
    return null
  }
  switch (parsed.data.error.code) {
    case PROJECT_EDIT_SESSION_CONFLICT:
      return EDIT_SESSION_CONFLICT_MESSAGE
    case PROJECT_EDIT_SESSION_CLOSED:
      return EDIT_SESSION_CLOSED_MESSAGE
    default:
      return null
  }
}

export const EDIT_SESSION_HEADER = 'X-Edit-Session-Id'

export const EditSessionSummarySchema = z.object({
  id: z.string().min(1),
  clientKind: z.enum(['web', 'desktop']),
  clientLabel: z.string(),
  openedAt: z.string(),
  lastSeenAt: z.string(),
}) satisfies z.ZodType<EditSessionSummary>

export const EditSessionOpenResponseSchema = z.object({
  session: z.object({ id: z.string().min(1) }),
  otherSessions: z.array(EditSessionSummarySchema),
  heartbeatIntervalMs: z.number().int().positive(),
})

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
  z.object({ status: z.literal('unavailable'), permanent: z.boolean() }),
]) satisfies z.ZodType<EditSessionOpened>

export const EditSessionBeatSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('active'), otherSessions: z.array(EditSessionSummarySchema) }),
  z.object({ status: z.literal('closed'), byOtherSession: z.boolean() }),
  z.object({ status: z.literal('gone') }),
  z.object({ status: z.literal('unknown') }),
]) satisfies z.ZodType<EditSessionBeat>

export function toEditSessionOpened(status: number, body: unknown): EditSessionOpened {
  if (status !== 201 && status !== 200) {
    return { status: 'unavailable', permanent: status === 400 || status === 403 }
  }
  const parsed = EditSessionOpenResponseSchema.safeParse(unwrapData(body))
  if (!parsed.success) {
    return { status: 'unavailable', permanent: false }
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
