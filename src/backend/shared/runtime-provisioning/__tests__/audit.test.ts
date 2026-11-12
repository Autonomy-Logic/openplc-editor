import type { AuditOperation, AuditOutcome } from '../audit'
import { formatAuditLine, PROVISIONING_AUDIT_PREFIX } from '../audit'

const STARTED_AT = Date.UTC(2026, 10, 5, 12, 0, 0, 0)
const ENDED_AT = Date.UTC(2026, 10, 5, 12, 3, 27, 450)
const PREFIX = '[runtime-provisioning-audit]'
const START_ISO = '2026-11-05T12:00:00.000Z'
const END_ISO = '2026-11-05T12:03:27.450Z'
const OPERATION: AuditOperation = 'install'
const OUTCOME: AuditOutcome = 'failure'

describe('formatAuditLine', () => {
  it('uses the fixed audit prefix', () => {
    expect(PROVISIONING_AUDIT_PREFIX).toBe(PREFIX)
  })

  const rows: [AuditOperation, AuditOutcome][] = [
    ['install', 'success'],
    ['start', 'failure'],
    ['inspect', 'failure'],
    ['install', 'cancelled'],
    ['install', 'unknown'],
  ]

  it.each(rows)('records target, %s operation, times and %s outcome on one line', (operation, outcome) => {
    const entry = { host: '192.168.1.50', port: 22, operation, startedAt: STARTED_AT, endedAt: ENDED_AT, outcome }

    expect(formatAuditLine(entry)).toBe(
      `${PREFIX} target=192.168.1.50:22 operation=${operation} start=${START_ISO} end=${END_ISO} outcome=${outcome}`,
    )
  })

  it('brackets an IPv6 target', () => {
    const line = formatAuditLine({
      host: 'fe80::1',
      port: 2222,
      operation: 'start',
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      outcome: 'success',
    })

    expect(line).toContain(' target=[fe80::1]:2222 ')
    expect(line).not.toContain('\n')
  })

  it('never writes credentials, even when the entry object carries them', () => {
    const entryWithCredentials = {
      host: '192.168.1.50',
      port: 22,
      operation: OPERATION,
      startedAt: STARTED_AT,
      endedAt: ENDED_AT,
      outcome: OUTCOME,
      username: 'commissioner42',
      password: 'S3cr3t-Pi!',
    }

    const line = formatAuditLine(entryWithCredentials)

    expect(line).not.toContain('commissioner42')
    expect(line).not.toContain('S3cr3t-Pi!')
  })

  it('takes a single entry argument', () => {
    expect(formatAuditLine).toHaveLength(1)
  })
})
