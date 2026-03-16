/**
 * Orchestrator API types and request stubs.
 * These will be implemented when the Edge API integration is built.
 */

export interface DeviceResponse {
  id: string
  name: string
  status: string
  container_status?: string
  is_running?: boolean
}

export interface OrchestratorResponse {
  id: string
  name: string
  orchestrator_id: string
  description: string | null
  devices: DeviceResponse[]
}

export interface ListOrchestratorsResponse {
  data: {
    orchestrators: OrchestratorResponse[]
  }
}

export function listOrchestratorsRequest(): Promise<ListOrchestratorsResponse> {
  throw new Error('Orchestrators API not yet implemented')
}
