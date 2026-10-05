/**
 * Which `conf/*.json` an upload would carry.
 *
 * The runtime enables a plugin by the PRESENCE of `core/generated/conf/<name>.json`
 * — there is no `enabled` key it reads at that level and no endpoint that reports
 * which plugins are on. So this file set is the enable state, and computing it
 * with the same function the bundle uses is the only honest way to answer
 * "will Modbus be listening" without an upload.
 */

import type { GenerateConfsInput } from '@root/backend/shared/compile/steps/generate-confs'
import { generateRuntimeConfs } from '@root/backend/shared/compile/steps/generate-confs'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'

export interface ProtocolConfSummary {
  /** The file the upload would write, or null when the protocol is off. */
  confFile: string | null
  enabled: boolean
}

export type ProtocolConfs =
  | { ok: true; confs: Record<string, ProtocolConfSummary> }
  /** The generators abort the compile rather than emit a bad config. */
  | { ok: false; error: string }

export function describeProtocolConfs(
  project: PLCProjectData,
  debugMapContent: string,
  log: GenerateConfsInput['log'],
): ProtocolConfs {
  let confs: ReturnType<typeof generateRuntimeConfs>
  try {
    confs = generateRuntimeConfs({
      servers: project.servers as GenerateConfsInput['servers'],
      remoteDevices: project.remoteDevices as GenerateConfsInput['remoteDevices'],
      instances: (project.configurations?.resource?.instances ?? []).map((instance) => ({
        name: instance.name,
        task: instance.task,
        program: instance.program,
      })),
      debugMapContent,
      log,
    })
  } catch (error) {
    // OPC-UA and EtherCAT both abort the compile from here rather than emitting
    // a bad config, so a throw is the answer, not a crash.
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }

  return {
    ok: true,
    confs: {
      modbusSlave: summarize('conf/modbus_slave.json', confs.modbusSlave),
      modbusMaster: summarize('conf/modbus_master.json', confs.modbusMaster),
      s7comm: summarize('conf/s7comm.json', confs.s7Comm),
      opcua: summarize('conf/opcua.json', confs.opcUa),
      ethercat: summarize('conf/ethercat.json', confs.ethercat),
    },
  }
}

function summarize(confFile: string, content: string | null): ProtocolConfSummary {
  return content === null ? { confFile: null, enabled: false } : { confFile, enabled: true }
}
