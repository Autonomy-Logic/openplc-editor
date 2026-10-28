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

const sessionsByProject = new Map<string, string>()

const pendingCloses = new Set<Promise<boolean>>()

function forget(projectId: string, sessionId: string): void {
  if (sessionsByProject.get(projectId) === sessionId) {
    sessionsByProject.delete(projectId)
  }
}

export function editSessionHeadersFor(projectId: string): Record<string, string> {
  const sessionId = sessionsByProject.get(projectId)
  return sessionId ? { [EDIT_SESSION_HEADER]: sessionId } : {}
}

export async function openEditSession(
  projectId: string,
  client: { kind: EditSessionClientKind; label: string },
  previousSessionId?: string,
): Promise<EditSessionOpened> {
  try {
    const response = await edgeAuthedRequest(editSessionsPath(projectId), {
      method: 'POST',
      json: {
        clientKind: client.kind,
        clientLabel: client.label,
        ...(previousSessionId ? { previousSessionId } : {}),
      },
    })
    if (!response) {
      return { status: 'unavailable', permanent: false }
    }
    const opened = toEditSessionOpened(response.status, parseJsonBody(response.body))
    if (opened.status === 'opened') {
      sessionsByProject.set(projectId, opened.sessionId)
    }
    return opened
  } catch {
    return { status: 'unavailable', permanent: false }
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
    return toEditSessionBeat(response.status, parseJsonBody(response.body))
  } catch {
    return { status: 'unknown' }
  }
}

export function closeEditSession(projectId: string, sessionId: string, closedBySessionId?: string): Promise<boolean> {
  const closingItself = closedBySessionId === undefined || closedBySessionId === sessionId
  const request = (async () => {
    try {
      const response = await edgeAuthedRequest(editSessionsPath(projectId, sessionId, 'close'), {
        method: 'POST',
        json: closingItself ? {} : { closedBySessionId },
      })
      const closed = response !== null && response.status >= 200 && response.status < 300
      if (closed && closingItself) {
        forget(projectId, sessionId)
      }
      return closed
    } catch {
      return false
    }
  })()
  pendingCloses.add(request)
  void request.finally(() => pendingCloses.delete(request))
  return request
}

export async function releaseAllEditSessions(): Promise<void> {
  const open = [...sessionsByProject.entries()]
  const releases = open.map(([projectId, sessionId]) => closeEditSession(projectId, sessionId))
  await Promise.allSettled([...releases, ...pendingCloses])
}

export function hasOpenEditSessions(): boolean {
  return sessionsByProject.size > 0 || pendingCloses.size > 0
}
