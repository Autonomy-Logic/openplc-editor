/**
 * Byte-for-byte reference tests for the EtherCAT configuration generator.
 *
 * These snapshot tests pin the generator's full output for two representative projects:
 *   1. A multi-mode drive (Delta ASDA-A2-E-style) exercising per-slave PDO assignment,
 *      PDO mapping rewrite, slave-level InitCmd ordering, and user startup SDOs.
 *   2. A modular coupler (UR20-style) exercising module channels in the iomapping,
 *      module startup SDOs, 0xF030 module-ident-list writes, and PDO mapping on
 *      a modular project.
 *
 * The committed fixture JSONs (fixtures/*.golden.json) are the authoritative shape.
 * Any change to the generator that alters either the busconfig OR the iomapping of
 * these two projects must come with an update to the fixture — the diff in the PR is
 * the record of what shipped.  A silent regression fails here with a visible JSON diff.
 *
 * NOTE: these are current-generator snapshots, not CODESYS-produced reference bytes.
 * Comparing against actual CODESYS output needs an authoring tool run that is not part
 * of this repository.  When a CODESYS trace is available for a given fixture, update
 * the golden JSON to match and keep this suite as the gate.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PLCRemoteDevice } from '@root/backend/shared/types/PLC/open-plc'

import { generateEtherdogConfigs } from '../generate-ethercat-config'
import { deltaMultiModeProject } from './fixtures/delta-multimode-project'
import { ur20ModularProject } from './fixtures/ur20-modular-project'

const FIXTURES_DIR = join(__dirname, 'fixtures')

const readGolden = (name: string): unknown => JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf-8'))

const run = (project: PLCRemoteDevice[]) => {
  const result = generateEtherdogConfigs(project)
  if (result === null) throw new Error('generator returned null')
  return {
    busconfig: JSON.parse(result.busconfig) as unknown,
    iomapping: JSON.parse(result.iomapping) as unknown,
  }
}

describe('Generator reference snapshots', () => {
  describe('Delta ASDA-A2-E multi-mode drive', () => {
    const output = run(deltaMultiModeProject)

    test('busconfig matches the committed reference', () => {
      expect(output.busconfig).toEqual(readGolden('delta-multimode.busconfig.golden.json'))
    })

    test('iomapping matches the committed reference', () => {
      expect(output.iomapping).toEqual(readGolden('delta-multimode.iomapping.golden.json'))
    })
  })

  describe('UR20 modular coupler', () => {
    const output = run(ur20ModularProject)

    test('busconfig matches the committed reference', () => {
      expect(output.busconfig).toEqual(readGolden('ur20-modular.busconfig.golden.json'))
    })

    test('iomapping matches the committed reference', () => {
      expect(output.iomapping).toEqual(readGolden('ur20-modular.iomapping.golden.json'))
    })
  })
})
