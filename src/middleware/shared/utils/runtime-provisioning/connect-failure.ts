import type { RuntimeConnectFailureKind } from '../../ports/runtime-port'

const FAILURE_BY_CODE: ReadonlyMap<string, RuntimeConnectFailureKind> = new Map([
  ['ECONNREFUSED', 'refused'],
  ['ETIMEDOUT', 'timeout'],
  ['EHOSTUNREACH', 'host-unreachable'],
  ['ENETUNREACH', 'network-unreachable'],
])

export function classifyRuntimeConnectError(input: { code?: string; timedOut: boolean }): RuntimeConnectFailureKind {
  if (input.timedOut) return 'timeout'
  if (input.code === undefined) return 'other'
  return FAILURE_BY_CODE.get(input.code) ?? 'other'
}

export function startsProvisioningChecks(kind: RuntimeConnectFailureKind | undefined): boolean {
  return kind !== undefined && kind !== 'other'
}
