/**
 * Desktop EditSessionPort. The main process holds the sessions and attaches
 * them to saves; this side only asks, and checks what comes back over IPC,
 * where a TypeScript annotation establishes nothing.
 *
 * Preload and renderer bundles can skew, so a missing channel answers as
 * "unavailable", which leaves the editor behaving as it did before sessions.
 */

import {
  EditSessionBeatSchema,
  EditSessionOpenedSchema,
  type EditSessionPort,
} from '../../shared/ports/edit-session-port'

export const editorEditSessionPort: EditSessionPort = {
  async open(projectId, client) {
    if (typeof window.bridge.edgeEditSessionOpen !== 'function') {
      return { status: 'unavailable' }
    }
    try {
      const parsed = EditSessionOpenedSchema.safeParse(await window.bridge.edgeEditSessionOpen(projectId, client))
      return parsed.success ? parsed.data : { status: 'unavailable' }
    } catch {
      return { status: 'unavailable' }
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

  async close(projectId, sessionId, closedBySessionId) {
    if (typeof window.bridge.edgeEditSessionClose !== 'function') {
      return false
    }
    try {
      return (await window.bridge.edgeEditSessionClose(projectId, sessionId, closedBySessionId)) === true
    } catch {
      return false
    }
  },

  release(projectId, sessionId) {
    // The main process outlives the renderer, so an ordinary close is as good as a beacon here.
    void this.close(projectId, sessionId)
  },
}
