/**
 * Editor OrchestratorPort adapter — no-op.
 *
 * The editor connects to devices directly (via IP address), not through
 * orchestrators. This adapter satisfies the PlatformPorts interface but
 * is never called because the UI is gated by hasOrchestratorDevices=false.
 */

import type { OrchestratorPort } from '../../shared/ports/orchestrator-port'

export function createEditorOrchestratorAdapter(): OrchestratorPort {
  return {
    async listOrchestrators() {
      return []
    },
  }
}
