import { describe, expect, it } from '@jest/globals'

import {
  EDIT_SESSION_CLOSED_MESSAGE,
  EDIT_SESSION_CONFLICT_MESSAGE,
  EDIT_SESSION_STALE_MESSAGE,
  editSessionRefusalMessage,
  editSessionsPath,
  toEditSessionBeat,
  toEditSessionOpened,
} from '../edit-session-port'

const other = {
  id: 'ckx1q2w3e4r5t6y7u8i9o0p1',
  clientKind: 'desktop',
  clientLabel: 'OpenPLC Editor on Windows',
  openedAt: '2026-09-23T12:00:00.000Z',
  lastSeenAt: '2026-09-23T12:01:00.000Z',
  isCurrent: false,
}

const openBody = {
  session: { id: 'mine0000000000000000000a' },
  otherSessions: [other],
  heartbeatIntervalMs: 20000,
  sessionTtlMs: 90000,
}

describe('toEditSessionOpened', () => {
  it('reads the platform envelope Autonomy Edge wraps responses in', () => {
    expect(toEditSessionOpened(201, { statusCode: 201, data: openBody })).toEqual({
      status: 'opened',
      sessionId: 'mine0000000000000000000a',
      stale: false,
      otherSessions: [expect.objectContaining({ id: other.id, clientKind: 'desktop' })],
      heartbeatIntervalMs: 20000,
    })
  })

  it('reports a session that continues a copy older than a save made elsewhere', () => {
    expect(toEditSessionOpened(201, { data: { ...openBody, stale: true } })).toEqual(
      expect.objectContaining({ status: 'opened', stale: true }),
    )
  })

  it('also reads an unwrapped body', () => {
    expect(toEditSessionOpened(201, openBody).status).toBe('opened')
  })

  it('is unavailable on a server without edit sessions, or any failure', () => {
    expect(toEditSessionOpened(404, { message: 'Cannot POST' })).toEqual({ status: 'unavailable', permanent: false })
    expect(toEditSessionOpened(503, null)).toEqual({ status: 'unavailable', permanent: false })
    expect(toEditSessionOpened(201, { data: { session: {} } })).toEqual({ status: 'unavailable', permanent: false })
  })

  it('marks as permanent the refusals retrying cannot fix', () => {
    expect(toEditSessionOpened(403, null)).toEqual({ status: 'unavailable', permanent: true })
    expect(toEditSessionOpened(400, null)).toEqual({ status: 'unavailable', permanent: true })
  })
})

describe('toEditSessionBeat', () => {
  it('reports the other live sessions', () => {
    expect(toEditSessionBeat(200, { data: { status: 'active', otherSessions: [other] } })).toEqual({
      status: 'active',
      otherSessions: [expect.objectContaining({ id: other.id })],
    })
  })

  it('reports a copy that is older than a save made elsewhere', () => {
    expect(toEditSessionBeat(200, { data: { status: 'stale', otherSessions: [other] } })).toEqual({
      status: 'stale',
      otherSessions: [expect.objectContaining({ id: other.id })],
    })
  })

  it('reports a session closed from another place', () => {
    expect(
      toEditSessionBeat(200, {
        data: { status: 'closed', closedReason: 'closed_by_other_session', otherSessions: [] },
      }),
    ).toEqual({ status: 'closed', byOtherSession: true })
  })

  it('tells a session this place released itself from one closed elsewhere', () => {
    expect(toEditSessionBeat(200, { data: { status: 'closed', closedReason: 'released', otherSessions: [] } })).toEqual(
      {
        status: 'closed',
        byOtherSession: false,
      },
    )
  })

  it('tells a forgotten session (404) from a question that could not be asked', () => {
    expect(toEditSessionBeat(404, null)).toEqual({ status: 'gone' })
    expect(toEditSessionBeat(500, null)).toEqual({ status: 'unknown' })
    expect(toEditSessionBeat(200, { data: { status: 'weird' } })).toEqual({ status: 'unknown' })
  })
})

describe('editSessionRefusalMessage', () => {
  const body = (code: string) =>
    JSON.stringify({ statusCode: 409, error: { code, message: 'server prose that may change' } })

  it('turns each refusal code into a sentence for the user', () => {
    expect(editSessionRefusalMessage(409, body('PROJECT_EDIT_SESSION_CONFLICT'))).toBe(EDIT_SESSION_CONFLICT_MESSAGE)
    expect(editSessionRefusalMessage(409, body('PROJECT_EDIT_SESSION_CLOSED'))).toBe(EDIT_SESSION_CLOSED_MESSAGE)
    expect(editSessionRefusalMessage(409, body('PROJECT_EDIT_SESSION_STALE'))).toBe(EDIT_SESSION_STALE_MESSAGE)
  })

  it('reads the code from the body, not from anywhere in the text', () => {
    const elsewhere = JSON.stringify({
      statusCode: 409,
      error: { code: 'OTHER', message: 'PROJECT_EDIT_SESSION_CONFLICT' },
    })
    expect(editSessionRefusalMessage(409, elsewhere)).toBeNull()
    expect(editSessionRefusalMessage(409, 'not json')).toBeNull()
  })

  it('leaves every other failure alone', () => {
    expect(editSessionRefusalMessage(409, body('SOMETHING_ELSE'))).toBeNull()
    expect(editSessionRefusalMessage(403, body('PROJECT_EDIT_SESSION_CONFLICT'))).toBeNull()
  })
})

describe('editSessionsPath', () => {
  it('encodes ids into the three routes', () => {
    expect(editSessionsPath('p 1')).toBe('/projects/p%201/edit-sessions')
    expect(editSessionsPath('p1', 's/1', 'heartbeat')).toBe('/projects/p1/edit-sessions/s%2F1/heartbeat')
    expect(editSessionsPath('p1', 's1', 'close')).toBe('/projects/p1/edit-sessions/s1/close')
  })
})
