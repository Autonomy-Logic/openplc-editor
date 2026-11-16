/**
 * The image is sized for the areas the device is given, and nothing else.
 *
 * Three places used to answer "which S7 areas does this target serve?" and two
 * of them filtered while the third did not. A project could then be sized for
 * an area no device would answer, and a located declaration could pass the
 * producer gate against a block the emitted file had dropped.
 *
 * This pins the agreement itself rather than one case of it: for the same
 * project and the same target, the tables the sizer counted are the tables the
 * emitted file names.
 */

import { computeIoImage, IMAGE_AREAS_BAREMETAL, IMAGE_AREAS_RUNTIME_V4 } from '../steps/compute-io-image'
import { collectS7Areas } from '@root/frontend/utils/s7comm'
import { generateS7CommConfig } from '@root/frontend/utils/s7comm'
import { tableForKey } from '@root/middleware/shared/utils/io-image/tables'
import {
  ALL_ADDRESS_PRODUCERS_ACTIVE,
  DEFAULT_S7_PROFILE,
  RUNTIME_V4_S7_PROFILE,
} from '@root/middleware/shared/utils/target-capabilities'
import type { PLCProjectData } from '../../types/PLC/open-plc'

/** Everything the selection is supposed to refuse, in one config: a repeated
 *  DB number, a buffer bare metal has no array for, and more blocks than the
 *  bare-metal ceiling admits. */
const config = {
  server: { enabled: true },
  dataBlocks: [
    { dbNumber: 1, description: '', sizeBytes: 4, mapping: { type: 'int_memory', startBuffer: 0 } },
    { dbNumber: 1, description: 'repeat', sizeBytes: 4, mapping: { type: 'int_memory', startBuffer: 40 } },
    { dbNumber: 2, description: '', sizeBytes: 8, mapping: { type: 'dint_input', startBuffer: 0 } },
    ...Array.from({ length: 9 }, (_, i) => ({
      dbNumber: 10 + i,
      description: '',
      sizeBytes: 4,
      mapping: { type: 'int_output', startBuffer: i * 5 },
    })),
  ],
  systemAreas: {
    peArea: { enabled: true, sizeBytes: 16, mapping: { type: 'int_input', startBuffer: 0 } },
  },
}

const project = {
  pous: [],
  dataTypes: [],
  servers: [{ name: 's7', protocol: 's7comm', s7commSlaveConfig: config }],
  remoteDevices: [],
  configuration: { resource: { globalVariables: [], tasks: [], instances: [] } },
} as unknown as PLCProjectData

const sizedTables = (areas: ReadonlySet<string>, s7: typeof DEFAULT_S7_PROFILE) =>
  Object.keys(
    computeIoImage({
      projectData: project,
      capabilities: ALL_ADDRESS_PRODUCERS_ACTIVE,
      serverCapabilities: { modbusTcpServer: false, opcuaServer: false, s7Server: true, s7 },
      areas,
    }).sizes,
  ).sort()

describe('S7 sizing follows what the target is given', () => {
  it('sizes the tables the bare-metal header emits, and no others', () => {
    const emitted = collectS7Areas(config, DEFAULT_S7_PROFILE, () => undefined)
    // The header names a buffer; the image names a prefix. Both come from the
    // same block, so the two sets have to line up through the table list.
    const fromHeader = [
      ...new Set(
        emitted
          .map((area) => area.buffer.replace('S7COMM_BUF_', '').toLowerCase())
          .map((key) => tableForKey(key)?.prefix)
          .filter((prefix) => prefix !== undefined),
      ),
    ].sort()

    expect(sizedTables(IMAGE_AREAS_BAREMETAL, DEFAULT_S7_PROFILE)).toEqual(fromHeader)
    // And the fixture is doing its job: the dropped buffer is really absent.
    expect(fromHeader).not.toContain('%ID')
  })

  it('sizes the tables the Runtime v4 config file carries, and no others', () => {
    const shipped = JSON.parse(generateS7CommConfig(project.servers as never, RUNTIME_V4_S7_PROFILE) ?? '{}') as {
      data_blocks: Array<{ mapping: { type: string } }>
    }
    const fromFile = [
      ...new Set(
        shipped.data_blocks.map((db) => tableForKey(db.mapping.type)?.prefix).filter((prefix) => prefix !== undefined),
      ),
      // The config file carries the system areas in their own section.
      '%IW',
    ].sort()

    expect(sizedTables(IMAGE_AREAS_RUNTIME_V4, RUNTIME_V4_S7_PROFILE)).toEqual(fromFile)
    // Eleven of the twelve blocks: v4 holds 64 and addresses every buffer, so
    // only the repeated DB number is dropped.
    expect(shipped.data_blocks).toHaveLength(11)
    expect(shipped.data_blocks.filter((db) => db.mapping.type === 'dint_input')).toHaveLength(1)
  })
})
