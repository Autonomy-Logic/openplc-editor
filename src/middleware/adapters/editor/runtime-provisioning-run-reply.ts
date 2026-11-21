import {
  type RuntimeProvisioningOutcome,
  toRuntimeProvisioningOutcome,
} from '../../shared/ports/runtime-provisioning-port'

/** The invoke reply of `runtime-provisioning:run`: the outcome and the token of its end marker. */
export interface RuntimeProvisioningRunReply {
  outcome: RuntimeProvisioningOutcome
  endToken: number
}

/** The marker main sends on `runtime-provisioning:event` after the last event of a run invocation. */
export interface RuntimeProvisioningRunEnd {
  type: 'run-end'
  token: number
}

function isPlainObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEndToken(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

/** Reads a run reply from main, or `null` when it carries no valid end token. */
export function toRunReply(value: unknown): RuntimeProvisioningRunReply | null {
  if (!isPlainObject(value) || !('endToken' in value)) return null
  const endToken = value.endToken
  if (!isEndToken(endToken)) return null
  const outcome = 'outcome' in value ? value.outcome : undefined
  return { outcome: toRuntimeProvisioningOutcome(outcome), endToken }
}

/** Reads the token of a run-end marker, or `null` when the value is not one. */
export function toRunEndToken(value: unknown): number | null {
  if (!isPlainObject(value) || !('type' in value) || value.type !== 'run-end' || !('token' in value)) return null
  const token = value.token
  return isEndToken(token) ? token : null
}
