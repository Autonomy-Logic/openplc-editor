/**
 * Desktop transports for runtime commercial licence delivery. All behaviour is
 * in the shared `utils/licensing/runtime-license-sync`.
 */

import type { RuntimeLicenseMechanisms } from '@root/middleware/shared/ports/runtime-license-mechanisms'

import { edgeRequest } from '../edge-account/edge-http'
import type { RuntimeApiClient } from '../runtime/runtime-api-client'

export function createRuntimeLicenseMechanisms(
  runtimeApi: Pick<RuntimeApiClient, 'runtimeApiExchange'>,
  ipAddress: string,
): RuntimeLicenseMechanisms {
  return {
    runtimeGet: (path) => runtimeApi.runtimeApiExchange('GET', ipAddress, path),
    runtimePost: (path, json) => runtimeApi.runtimeApiExchange('POST', ipAddress, path, JSON.stringify(json)),
    edgePost: (path, json) => edgeRequest(path, { method: 'POST', json }),
  }
}
