/**
 * Edit sessions held by the desktop main process, and how they ride along on a
 * save (EDGE-652). HTTP is stubbed at the same seam the cloud project tests use.
 */

import {
  EDIT_SESSION_CLOSED_MESSAGE,
  EDIT_SESSION_CONFLICT_MESSAGE,
} from '../../../../middleware/shared/ports/edit-session-port'
import { edgeAuthedRequest } from '../../edge-account/edge-account-service'
import { saveCloudProject } from '../../edge-projects'
import {
  closeEditSession,
  editSessionHeadersFor,
  hasOpenEditSessions,
  heartbeatEditSession,
  openEditSession,
  releaseAllEditSessions,
} from '..'

jest.mock('../../edge-account/edge-account-service', () => ({
  edgeAuthedRequest: jest.fn(),
}))

const request = jest.mocked(edgeAuthedRequest)

type EdgeResponse = Awaited<ReturnType<typeof edgeAuthedRequest>>

const opened = (sessionId: string, otherSessions: unknown[] = []): EdgeResponse => ({
  status: 201,
  body: JSON.stringify({
    statusCode: 201,
    data: { session: { id: sessionId }, otherSessions, heartbeatIntervalMs: 20000, sessionTtlMs: 90000 },
  }),
})

const DESKTOP = { kind: 'desktop' as const, label: 'OpenPLC Editor on macOS' }

const FILES = {
  'project.json': '{"meta":{"name":"Irrigation","type":"plc-project"}}',
  pous: { programs: { 'main.st': 'x := TRUE;' } },
  devices: { 'configuration.json': '{}', 'pin-mapping.json': '[]' },
}

const writeFiles = {
  projectPath: 'p1',
  projectJson: '{"meta":{"name":"Irrigation"}}',
  deviceConfig: '{}',
  pinMapping: '[]',
  libraryManifest: '',
  pouFiles: [{ relativePath: 'pous/programs/main.st', content: 'x := TRUE;' }],
  serverFiles: [],
  remoteDeviceFiles: [],
  dataTypeFiles: [],
  deletions: [],
}

/** The headers the n-th request was sent with. */
const headersOf = (callIndex: number) => request.mock.calls[callIndex]?.[1]?.headers

beforeEach(async () => {
  jest.clearAllMocks()
  // Module state survives between tests; start every test with no session held.
  request.mockResolvedValue({ status: 200, body: '{}' })
  await releaseAllEditSessions()
  jest.clearAllMocks()
})

describe('openEditSession', () => {
  it('registers this window and reports the other places', async () => {
    const other = {
      id: 'web-session',
      clientKind: 'web',
      clientLabel: 'Chrome on Windows',
      openedAt: '2026-09-23T12:00:00.000Z',
      lastSeenAt: '2026-09-23T12:00:00.000Z',
    }
    request.mockResolvedValueOnce(opened('mine', [other]))

    const result = await openEditSession('p1', DESKTOP)

    expect(request.mock.calls[0][0]).toBe('/projects/p1/edit-sessions')
    expect(request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      json: { clientKind: 'desktop', clientLabel: 'OpenPLC Editor on macOS' },
    })
    expect(result).toMatchObject({ status: 'opened', sessionId: 'mine', otherSessions: [{ id: 'web-session' }] })
    expect(editSessionHeadersFor('p1')).toEqual({ 'X-Edit-Session-Id': 'mine' })
  })

  it('is unavailable, and attaches nothing, against a server without edit sessions', async () => {
    request.mockResolvedValueOnce({ status: 404, body: '{"message":"Cannot POST"}' })

    await expect(openEditSession('p1', DESKTOP)).resolves.toEqual({ status: 'unavailable' })
    expect(editSessionHeadersFor('p1')).toEqual({})
  })

  it('is unavailable when signed out or offline', async () => {
    request.mockResolvedValueOnce(null)
    await expect(openEditSession('p1', DESKTOP)).resolves.toEqual({ status: 'unavailable' })

    request.mockRejectedValueOnce(new Error('ENOTFOUND'))
    await expect(openEditSession('p1', DESKTOP)).resolves.toEqual({ status: 'unavailable' })
  })
})

describe('saving with an edit session', () => {
  it('names the session on the save', async () => {
    request.mockResolvedValueOnce(opened('mine'))
    await openEditSession('p1', DESKTOP)
    request
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ data: { files: FILES } }) })
      .mockResolvedValueOnce({ status: 200, body: '{}' })

    await expect(saveCloudProject(writeFiles)).resolves.toEqual({ success: true })

    expect(request.mock.calls[2][0]).toBe('/projects/p1/files/save')
    expect(headersOf(2)).toEqual({ 'X-Edit-Session-Id': 'mine' })
  })

  it('tells the user why a save was refused while the project is open elsewhere', async () => {
    request
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ data: { files: FILES } }) })
      .mockResolvedValueOnce({
        status: 409,
        body: JSON.stringify({ statusCode: 409, error: { code: 'PROJECT_EDIT_SESSION_CONFLICT' } }),
      })

    await expect(saveCloudProject(writeFiles)).resolves.toEqual({
      success: false,
      error: EDIT_SESSION_CONFLICT_MESSAGE,
    })
  })

  it('tells the user when this window was closed from another place', async () => {
    request
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ data: { files: FILES } }) })
      .mockResolvedValueOnce({
        status: 409,
        body: JSON.stringify({ statusCode: 409, error: { code: 'PROJECT_EDIT_SESSION_CLOSED' } }),
      })

    await expect(saveCloudProject(writeFiles)).resolves.toEqual({
      success: false,
      error: EDIT_SESSION_CLOSED_MESSAGE,
    })
  })

  it('sends a save with no session header when no session is open', async () => {
    request
      .mockResolvedValueOnce({ status: 200, body: JSON.stringify({ data: { files: FILES } }) })
      .mockResolvedValueOnce({ status: 200, body: '{}' })

    await saveCloudProject(writeFiles)

    expect(headersOf(1)).toEqual({})
  })
})

describe('closing', () => {
  it('stops attaching a session this window released', async () => {
    request.mockResolvedValueOnce(opened('mine'))
    await openEditSession('p1', DESKTOP)
    request.mockResolvedValueOnce({ status: 200, body: '{"data":{"closed":true}}' })

    await expect(closeEditSession('p1', 'mine')).resolves.toBe(true)

    expect(request.mock.calls[1][0]).toBe('/projects/p1/edit-sessions/mine/close')
    expect(request.mock.calls[1][1]).toMatchObject({ method: 'POST', json: {} })
    expect(editSessionHeadersFor('p1')).toEqual({})
  })

  it('keeps its own session when it closes another place', async () => {
    request.mockResolvedValueOnce(opened('mine'))
    await openEditSession('p1', DESKTOP)
    request.mockResolvedValueOnce({ status: 200, body: '{}' })

    await closeEditSession('p1', 'web-session', 'mine')

    expect(request.mock.calls[1][0]).toBe('/projects/p1/edit-sessions/web-session/close')
    expect(request.mock.calls[1][1]).toMatchObject({ json: { closedBySessionId: 'mine' } })
    expect(editSessionHeadersFor('p1')).toEqual({ 'X-Edit-Session-Id': 'mine' })
  })

  it('keeps attaching a session the server reports closed, so its stale save is refused, not applied', async () => {
    request.mockResolvedValueOnce(opened('mine'))
    await openEditSession('p1', DESKTOP)
    request.mockResolvedValueOnce({
      status: 200,
      body: JSON.stringify({ data: { status: 'closed', closedReason: 'closed_by_other_session', otherSessions: [] } }),
    })

    await expect(heartbeatEditSession('p1', 'mine')).resolves.toEqual({ status: 'closed', byOtherSession: true })
    expect(editSessionHeadersFor('p1')).toEqual({ 'X-Edit-Session-Id': 'mine' })
  })

  it('stops attaching a session the server forgot, so saves are not refused as closed', async () => {
    request.mockResolvedValueOnce(opened('mine'))
    await openEditSession('p1', DESKTOP)
    request.mockResolvedValueOnce({ status: 404, body: '{}' })

    await expect(heartbeatEditSession('p1', 'mine')).resolves.toEqual({ status: 'gone' })
    expect(editSessionHeadersFor('p1')).toEqual({})
  })

  it('waits on quit for a close already on the wire', async () => {
    request.mockResolvedValueOnce(opened('mine'))
    await openEditSession('p1', DESKTOP)
    let answer: (response: EdgeResponse) => void = () => undefined
    request.mockImplementationOnce(() => new Promise<EdgeResponse>((resolve) => (answer = resolve)))

    // The window's unload closes its session; the app quits right after.
    void closeEditSession('p1', 'mine')
    expect(hasOpenEditSessions()).toBe(true)
    let released = false
    const quitting = releaseAllEditSessions().then(() => {
      released = true
    })
    await Promise.resolve()
    expect(released).toBe(false)

    answer({ status: 200, body: '{}' })
    await quitting
    expect(released).toBe(true)
    expect(hasOpenEditSessions()).toBe(false)
  })

  it('releases every open session on quit', async () => {
    request.mockResolvedValueOnce(opened('a')).mockResolvedValueOnce(opened('b'))
    await openEditSession('p1', DESKTOP)
    await openEditSession('p2', DESKTOP)
    expect(hasOpenEditSessions()).toBe(true)
    request.mockResolvedValue({ status: 200, body: '{}' })

    await releaseAllEditSessions()

    const closed = request.mock.calls.slice(2).map(([path]) => path)
    expect(closed).toEqual(
      expect.arrayContaining(['/projects/p1/edit-sessions/a/close', '/projects/p2/edit-sessions/b/close']),
    )
    expect(hasOpenEditSessions()).toBe(false)
  })
})
