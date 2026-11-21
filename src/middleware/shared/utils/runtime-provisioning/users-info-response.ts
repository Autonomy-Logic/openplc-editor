import type { UsersInfoRawFacts, UsersInfoResult } from '../../ports/runtime-port'
import { classifyRuntimeConnectError } from './connect-failure'

function withRuntimeVersion(result: UsersInfoResult, runtimeVersion: string | undefined): UsersInfoResult {
  return runtimeVersion === undefined ? result : { ...result, runtimeVersion }
}

export function usersInfoFromFacts(facts: UsersInfoRawFacts): UsersInfoResult {
  if (facts.kind === 'error') {
    return {
      hasUsers: false,
      error: facts.message,
      failure: classifyRuntimeConnectError({ code: facts.code, timedOut: facts.timedOut }),
    }
  }
  if (facts.statusCode === 404) return withRuntimeVersion({ hasUsers: false }, facts.runtimeVersion)
  if (facts.statusCode === 200) return withRuntimeVersion({ hasUsers: true }, facts.runtimeVersion)
  return withRuntimeVersion(
    { hasUsers: false, error: facts.body || `Unexpected status: ${facts.statusCode}` },
    facts.runtimeVersion,
  )
}
