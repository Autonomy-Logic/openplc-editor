// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'

import { enrichDeviceData } from '../../../../../backend/shared/ethercat/enrich-device-data'
import { parseESIDeviceFull } from '../../../../../backend/shared/ethercat/esi-parser-main'
import {
  isValidIecIdentifier,
  sanitizeAxisName,
  serializeSoftMotionAxisGlobalsToST,
  softMotionAxisNames,
} from '../softmotion-axis-naming'

const ESI_XML = readFileSync(
  resolve(__dirname, '../../../../../backend/shared/ethercat/__tests__/fixtures/cia402-servo-esi.xml'),
  'utf-8',
)

function makeDevice(name: string): ConfiguredEtherCATDevice {
  const parsed = parseESIDeviceFull(ESI_XML, 0)
  const enriched = enrichDeviceData(parsed.device!)
  return {
    id: 'dev-1',
    name,
    esiDeviceRef: { repositoryItemId: 'repo-1', deviceIndex: 0 },
    vendorId: '0x0',
    productCode: '0x0',
    revisionNo: '0x0',
    addedFrom: 'repository',
    config: {} as ConfiguredEtherCATDevice['config'],
    ...enriched,
  }
}

function makeProject(devices: ConfiguredEtherCATDevice[]): PLCProjectData {
  return {
    dataTypes: [],
    pous: [
      {
        name: 'main',
        pouType: 'program',
        interface: { variables: [] },
        body: { language: 'st', value: '' },
      },
    ],
    configurations: {
      resource: {
        tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 1 }],
        instances: [{ name: 'instance0', task: 'task0', program: 'main' }],
        globalVariables: [],
      },
    },
    remoteDevices: [{ name: 'ethercat-bus', protocol: 'ethercat', ethercatConfig: { devices } }],
  }
}

describe('sanitizeAxisName', () => {
  it('sanitizes device names into valid IEC identifiers', () => {
    expect(sanitizeAxisName('X_Axis')).toBe('X_Axis')
    expect(sanitizeAxisName('My Axis 01')).toBe('My_Axis_01')
    expect(sanitizeAxisName('9drive')).toBe('_9drive')
  })
})

describe('isValidIecIdentifier', () => {
  it('validates IEC identifiers', () => {
    expect(isValidIecIdentifier('X_Axis')).toBe(true)
    expect(isValidIecIdentifier('_axis1')).toBe(true)
    expect(isValidIecIdentifier('ASDA-A2-E')).toBe(false)
    expect(isValidIecIdentifier('My Axis')).toBe(false)
    expect(isValidIecIdentifier('9drive')).toBe(false)
    expect(isValidIecIdentifier('')).toBe(false)
  })
})

describe('softMotionAxisNames', () => {
  it('returns sanitized names of enabled axes', () => {
    expect(softMotionAxisNames(makeProject([makeDevice('My Axis')]))).toEqual(['My_Axis'])
  })
  it('returns [] when there are no axes', () => {
    expect(softMotionAxisNames(makeProject([]))).toEqual([])
  })
})

describe('serializeSoftMotionAxisGlobalsToST', () => {
  it('returns empty string when there are no axes', () => {
    expect(serializeSoftMotionAxisGlobalsToST(makeProject([]))).toBe('')
  })

  it('declares each axis as a bare top-level VAR_GLOBAL of type AXIS_REF_SM3', () => {
    const st = serializeSoftMotionAxisGlobalsToST(makeProject([makeDevice('X_Axis')]))
    expect(st).toContain('X_Axis : AXIS_REF_SM3;')
    // Bare top-level block (ambient global) — NOT wrapped in a CONFIGURATION,
    // so the axis resolves without VAR_EXTERNAL.
    expect(st.startsWith('VAR_GLOBAL')).toBe(true)
    expect(st).toContain('END_VAR')
    expect(st).not.toContain('CONFIGURATION')
  })

  it('lists axes in softMotionAxisNames order (line N+1 = axis N)', () => {
    const project = makeProject([makeDevice('X_Axis')])
    const st = serializeSoftMotionAxisGlobalsToST(project)
    const names = softMotionAxisNames(project)
    const lines = st.split('\n')
    // line 0 = VAR_GLOBAL, line 1 = first axis
    expect(lines[1]).toContain(names[0])
  })
})
