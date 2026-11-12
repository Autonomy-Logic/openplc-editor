import { formatProvisioningTarget } from '@root/middleware/shared/ports/runtime-provisioning-port'

export const PROVISIONING_AUDIT_PREFIX = '[runtime-provisioning-audit]'

export type AuditOperation = 'inspect' | 'start' | 'install'

export type AuditOutcome = 'success' | 'failure' | 'cancelled' | 'unknown'

export function formatAuditLine(entry: {
  host: string
  port: number
  operation: AuditOperation
  startedAt: number
  endedAt: number
  outcome: AuditOutcome
}): string {
  const target = formatProvisioningTarget(entry.host, entry.port)
  const start = new Date(entry.startedAt).toISOString()
  const end = new Date(entry.endedAt).toISOString()
  return `${PROVISIONING_AUDIT_PREFIX} target=${target} operation=${entry.operation} start=${start} end=${end} outcome=${entry.outcome}`
}
