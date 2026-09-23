/**
 * Edit sessions for cloud projects open in this desktop editor (EDGE-652).
 *
 * The main process owns them, not the renderer, for the same reason it owns
 * the tokens: the save to Autonomy Edge is made here, and the session has to
 * travel with it. A save of a project with an open session carries its id, so
 * the server can refuse it while the project is open somewhere else.
 *
 * The id stays attached after the server reports the session closed from
 * another place. Dropping it would send the next save unguarded, and that save
 * is exactly the one that must not overwrite the copy the user kept.
 */

import {
  EDIT_SESSION_HEADER,
  type EditSessionBeat,
  type EditSessionClientKind,
  type EditSessionOpened,
  editSessionsPath,
  toEditSessionBeat,
  toEditSessionOpened,
} from '../../../middleware/shared/ports/edit-session-port'
import { edgeAuthedRequest } from '../edge-account/edge-account-service'
import { parseJsonBody } from '../edge-account/edge-http'

/** projectId → the session this editor holds on it. */
const sessionsByProject = new Map<string, string>()

/**
 * Close requests still on the wire. The window's own unload closes its
 * session a moment before the app quits; without waiting for these, the quit
 * would cut that request off and the other place would keep showing a ghost
 * desktop session until the server's TTL.
 */
const pendingCloses = new Set<Promise<boolean>>()

function forget(projectId: string, sessionId: string): void {
  if (sessionsByProject.get(projectId) === sessionId) {
    sessionsByProject.delete(projectId)
  }
}

/** Headers for a save of `projectId`: the session header when one is open, nothing otherwise. */
export function editSessionHeadersFor(projectId: string): Record<string, string> {
  const sessionId = sessionsByProject.get(projectId)
  return sessionId ? { [EDIT_SESSION_HEADER]: sessionId } : {}
}

export async function openEditSession(
  projectId: string,
  client: { kind: EditSessionClientKind; label: string },
): Promise<EditSessionOpened> {
  try {
    const response = await edgeAuthedRequest(editSessionsPath(projectId), {
      method: 'POST',
      json: { clientKind: client.kind, clientLabel: client.label },
    })
    if (!response) {
      return { status: 'unavailable' }
    }
    const opened = toEditSessionOpened(response.status, parseJsonBody(response.body))
    if (opened.status === 'opened') {
      sessionsByProject.set(projectId, opened.sessionId)
    }
    return opened
  } catch {
    return { status: 'unavailable' }
  }
}

export async function heartbeatEditSession(projectId: string, sessionId: string): Promise<EditSessionBeat> {
  try {
    const response = await edgeAuthedRequest(editSessionsPath(projectId, sessionId, 'heartbeat'), {
      method: 'POST',
    })
    if (!response) {
      return { status: 'unknown' }
    }
    const beat = toEditSessionBeat(response.status, parseJsonBody(response.body))
    // A forgotten session must not keep riding on saves: every save would be
    // refused as closed while the renderer opens a new one.
    if (beat.status === 'gone') {
      forget(projectId, sessionId)
    }
    return beat
  } catch {
    return { status: 'unknown' }
  }
}

export function closeEditSession(projectId: string, sessionId: string, closedBySessionId?: string): Promise<boolean> {
  const closingItself = closedBySessionId === undefined || closedBySessionId === sessionId
  if (closingItself) {
    forget(projectId, sessionId)
  }
  const request = (async () => {
    try {
      const response = await edgeAuthedRequest(editSessionsPath(projectId, sessionId, 'close'), {
        method: 'POST',
        json: closingItself ? {} : { closedBySessionId },
      })
      return response !== null && response.status >= 200 && response.status < 300
    } catch {
      return false
    }
  })()
  pendingCloses.add(request)
  void request.finally(() => pendingCloses.delete(request))
  return request
}

/** On quit: release every session still open and wait for closes already on the wire. Best effort. */
export async function releaseAllEditSessions(): Promise<void> {
  const open = [...sessionsByProject.entries()]
  const releases = open.map(([projectId, sessionId]) => closeEditSession(projectId, sessionId))
  await Promise.allSettled([...releases, ...pendingCloses])
}

/** True while there is anything to release or wait for before the process ends. */
export function hasOpenEditSessions(): boolean {
  return sessionsByProject.size > 0 || pendingCloses.size > 0
}
