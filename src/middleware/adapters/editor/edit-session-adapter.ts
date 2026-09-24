import {
  EditSessionBeatSchema,
  EditSessionOpenedSchema,
  type EditSessionPort,
} from '../../shared/ports/edit-session-port'

async function close(projectId: string, sessionId: string, closedBySessionId?: string): Promise<boolean> {
  if (typeof window.bridge.edgeEditSessionClose !== 'function') {
    return false
  }
  try {
    return (await window.bridge.edgeEditSessionClose(projectId, sessionId, closedBySessionId)) === true
  } catch {
    return false
  }
}

export const editorEditSessionPort: EditSessionPort = {
  async open(projectId, client) {
    if (typeof window.bridge.edgeEditSessionOpen !== 'function') {
      return { status: 'unavailable', permanent: true }
    }
    try {
      const parsed = EditSessionOpenedSchema.safeParse(await window.bridge.edgeEditSessionOpen(projectId, client))
      return parsed.success ? parsed.data : { status: 'unavailable', permanent: false }
    } catch {
      return { status: 'unavailable', permanent: false }
    }
  },

  async heartbeat(projectId, sessionId) {
    if (typeof window.bridge.edgeEditSessionHeartbeat !== 'function') {
      return { status: 'unknown' }
    }
    try {
      const parsed = EditSessionBeatSchema.safeParse(await window.bridge.edgeEditSessionHeartbeat(projectId, sessionId))
      return parsed.success ? parsed.data : { status: 'unknown' }
    } catch {
      return { status: 'unknown' }
    }
  },

  close,

  release(projectId, sessionId) {
    void close(projectId, sessionId)
  },
}
