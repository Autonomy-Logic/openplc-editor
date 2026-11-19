/**
 * Writes the HmiAlarms identity and source as JSON for run.mjs.
 * Usage: ts-node tests/hmi-alarms/library-sources.ts <out.json>
 */
import { writeFileSync } from 'node:fs'

import { HMI_ALARMS_LIBRARY, HMI_ALARMS_ST } from '../../src/backend/shared/hmi/plc-lib/hmi-alarms'

const [out] = process.argv.slice(2)
if (!out) throw new Error('usage: library-sources.ts <out.json>')
writeFileSync(
  out,
  JSON.stringify({ library: HMI_ALARMS_LIBRARY, sources: [{ fileName: 'hmi_alarms.st', source: HMI_ALARMS_ST }] }),
)
