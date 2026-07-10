// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'
import type { PLCProjectData } from '@root/middleware/shared/ports/types'

import { enrichDeviceData } from '../enrich-device-data'
import { parseESIDeviceFull } from '../esi-parser-main'
import {
  generateSoftMotionArtifacts,
  injectAxisExternals,
  isValidIecIdentifier,
  serializeSoftMotionAxisGlobalsToST,
  SM3_BRIDGE_INSTANCE_NAME,
  SM3_BRIDGE_POU_NAME,
  sanitizeAxisName,
  softMotionAxisNames,
} from '../generate-softmotion'

const ESI_XML = readFileSync(resolve(__dirname, 'fixtures/cia402-servo-esi.xml'), 'utf-8')

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

describe('generateSoftMotionArtifacts', () => {
  it('sanitizes device names into valid IEC identifiers', () => {
    expect(sanitizeAxisName('X_Axis')).toBe('X_Axis')
    expect(sanitizeAxisName('My Axis 01')).toBe('My_Axis_01')
    expect(sanitizeAxisName('9drive')).toBe('_9drive')
  })

  it('validates IEC identifiers', () => {
    expect(isValidIecIdentifier('X_Axis')).toBe(true)
    expect(isValidIecIdentifier('_axis1')).toBe(true)
    expect(isValidIecIdentifier('ASDA-A2-E')).toBe(false)
    expect(isValidIecIdentifier('My Axis')).toBe(false)
    expect(isValidIecIdentifier('9drive')).toBe(false)
    expect(isValidIecIdentifier('')).toBe(false)
  })

  it('is a no-op when there are no CiA 402 axes', () => {
    const project = makeProject([])
    expect(generateSoftMotionArtifacts(project)).toBe(project)
  })

  describe('softMotionAxisNames', () => {
    it('returns sanitized names of enabled axes', () => {
      expect(softMotionAxisNames(makeProject([makeDevice('My Axis')]))).toEqual(['My_Axis'])
    })
    it('returns [] when there are no axes', () => {
      expect(softMotionAxisNames(makeProject([]))).toEqual([])
    })
  })

  describe('injectAxisExternals', () => {
    const prog = (value: string) =>
      ({ name: 'p', pouType: 'program', interface: { variables: [] }, body: { language: 'st', value } }) as never

    it('adds the external to a program that references the axis', () => {
      const out = injectAxisExternals(prog('pwr(Axis := Ax);'), ['Ax'])
      expect(out.interface!.variables.some((v) => v.name === 'Ax' && v.class === 'external')).toBe(true)
    })
    it('leaves a POU that does not reference any axis unchanged', () => {
      const pou = prog('y := 1;')
      expect(injectAxisExternals(pou, ['Ax'])).toBe(pou)
    })
    it('skips a function POU', () => {
      const fn = {
        name: 'f',
        pouType: 'function',
        interface: { variables: [] },
        body: { language: 'st', value: 'x := Ax;' },
      } as never
      expect(injectAxisExternals(fn, ['Ax'])).toBe(fn)
    })
  })

  describe('serializeSoftMotionAxisGlobalsToST', () => {
    it('returns empty string when there are no axes', () => {
      expect(serializeSoftMotionAxisGlobalsToST(makeProject([]))).toBe('')
    })

    it('declares each axis as a VAR_GLOBAL of type AXIS_REF_SM3', () => {
      const st = serializeSoftMotionAxisGlobalsToST(makeProject([makeDevice('X_Axis')]))
      expect(st).toContain('VAR_GLOBAL')
      expect(st).toContain('X_Axis : AXIS_REF_SM3;')
      expect(st).toContain('END_VAR')
      expect(st).toContain('CONFIGURATION')
    })
  })

  it('is a no-op when the CiA 402 device is disabled', () => {
    const dev = makeDevice('X_Axis')
    dev.cia402 = { ...dev.cia402!, enabled: false }
    const project = makeProject([dev])
    expect(generateSoftMotionArtifacts(project)).toBe(project)
  })

  it('generates the AXIS_REF_SM3 global named after the device', () => {
    const project = makeProject([makeDevice('X_Axis')])
    const out = generateSoftMotionArtifacts(project)
    const globals = out.configurations.resource.globalVariables
    const axis = globals.find((g) => g.name === 'X_Axis')
    expect(axis).toBeDefined()
    expect(axis!.type).toEqual({ definition: 'derived', value: 'AXIS_REF_SM3' })
    expect(axis!.location).toBe('')
  })

  it('generates located scalar globals bound to the drive PDO addresses', () => {
    const project = makeProject([makeDevice('X_Axis')])
    const globals = generateSoftMotionArtifacts(project).configurations.resource.globalVariables
    const ctrl = globals.find((g) => g.name === 'X_Axis_controlWord')
    const status = globals.find((g) => g.name === 'X_Axis_statusWord')
    const target = globals.find((g) => g.name === 'X_Axis_targetPosition')
    expect(ctrl?.type.value).toBe('uint')
    expect(ctrl?.location).toMatch(/^%Q/)
    expect(status?.type.value).toBe('uint')
    expect(status?.location).toMatch(/^%I/)
    expect(target?.type.value).toBe('dint') // forced to DINT for bridge compatibility
    expect(target?.location).toMatch(/^%Q/)
  })

  it('generates a bridge program with an SM_Drive instance and pin bindings', () => {
    const project = makeProject([makeDevice('X_Axis')])
    const out = generateSoftMotionArtifacts(project)
    const bridge = out.pous.find((p) => p.name === SM3_BRIDGE_POU_NAME)
    expect(bridge).toBeDefined()
    expect(bridge!.pouType).toBe('program')
    const fbVar = bridge!.interface!.variables.find((v) => v.name === 'X_Axis_drive')
    expect(fbVar!.type).toEqual({ definition: 'derived', value: 'SM_Drive_GenericDS402' })
    const body = bridge!.body.value as string
    // input pins bound with :=, output pins captured with =>
    expect(body).toContain('Axis := X_Axis')
    expect(body).toContain('wStatusWord := X_Axis_statusWord')
    expect(body).toContain('diActualPosition := X_Axis_positionActual')
    expect(body).toContain('wControlWord => X_Axis_controlWord')
    expect(body).toContain('diTargetPosition => X_Axis_targetPosition')
    // scaling applied
    expect(body).toContain('X_Axis.fScalefactor :=')
  })

  it('injects VAR_EXTERNAL for the axis into a user program that references it', () => {
    const project = makeProject([makeDevice('X_Axis')])
    project.pous[0].body = { language: 'st', value: 'pwr(Axis := X_Axis, Enable := TRUE);' }
    const out = generateSoftMotionArtifacts(project)
    const main = out.pous.find((p) => p.name === 'main')!
    const ext = main.interface!.variables.find((v) => v.name === 'X_Axis')
    expect(ext).toBeDefined()
    expect(ext!.class).toBe('external')
    expect(ext!.type).toEqual({ definition: 'derived', value: 'AXIS_REF_SM3' })
  })

  it('does not double-declare an axis the user already declared', () => {
    const project = makeProject([makeDevice('X_Axis')])
    project.pous[0].interface = {
      variables: [
        {
          name: 'X_Axis',
          class: 'external',
          type: { definition: 'derived', value: 'AXIS_REF_SM3' },
          location: '',
          documentation: '',
        },
      ],
    }
    project.pous[0].body = { language: 'st', value: 'pwr(Axis := X_Axis);' }
    const out = generateSoftMotionArtifacts(project)
    const main = out.pous.find((p) => p.name === 'main')!
    expect(main.interface!.variables.filter((v) => v.name === 'X_Axis')).toHaveLength(1)
  })

  it('detects axis references in graphical (non-string) POU bodies', () => {
    const project = makeProject([makeDevice('X_Axis')])
    // A function POU is left untouched; a graphical program referencing the axis gets the external.
    project.pous[0].body = { language: 'fbd', value: { rung: { nodes: [{ variable: 'X_Axis' }] } } } as never
    const out = generateSoftMotionArtifacts(project)
    const main = out.pous.find((p) => p.name === 'main')!
    expect(main.interface!.variables.some((v) => v.name === 'X_Axis' && v.class === 'external')).toBe(true)
  })

  it('injects the axis external into a function block that references it', () => {
    const project = makeProject([makeDevice('X_Axis')])
    project.pous.push({
      name: 'MotionFB',
      pouType: 'function-block',
      interface: { variables: [] },
      body: { language: 'st', value: 'x := X_Axis.fActPosition;' },
    })
    const out = generateSoftMotionArtifacts(project)
    const fb = out.pous.find((p) => p.name === 'MotionFB')!
    const ext = fb.interface!.variables.find((v) => v.name === 'X_Axis')
    expect(ext?.class).toBe('external')
    expect(ext?.type).toEqual({ definition: 'derived', value: 'AXIS_REF_SM3' })
  })

  it('leaves functions untouched (they cannot hold VAR_EXTERNAL)', () => {
    const project = makeProject([makeDevice('X_Axis')])
    project.pous.push({
      name: 'helperFn',
      pouType: 'function',
      interface: { variables: [] },
      body: { language: 'st', value: 'x := X_Axis.fActPosition;' },
    })
    const out = generateSoftMotionArtifacts(project)
    const fn = out.pous.find((p) => p.name === 'helperFn')!
    expect(fn.interface!.variables.some((v) => v.name === 'X_Axis')).toBe(false)
  })

  it('runs the bridge first each scan (instance unshifted to the front)', () => {
    const project = makeProject([makeDevice('X_Axis')])
    const instances = generateSoftMotionArtifacts(project).configurations.resource.instances
    expect(instances[0].name).toBe(SM3_BRIDGE_INSTANCE_NAME)
    expect(instances[0].program).toBe(SM3_BRIDGE_POU_NAME)
    expect(instances[0].task).toBe('task0')
    expect(instances.map((i) => i.name)).toContain('instance0')
  })

  it('honors configured scaling in the generated bridge', () => {
    const dev = makeDevice('X_Axis')
    dev.cia402 = { enabled: true, scaleNum: 1, scaleDenom: 1, scaleFactor: 1000 }
    const out = generateSoftMotionArtifacts(makeProject([dev]))
    const body = out.pous.find((p) => p.name === SM3_BRIDGE_POU_NAME)!.body.value as string
    expect(body).toContain('X_Axis.fScalefactor := 1000.0;')
  })

  describe('edge cases', () => {
    it('ignores non-ethercat remote devices', () => {
      const project = makeProject([])
      project.remoteDevices = [{ name: 'mb', protocol: 'modbus-tcp' }]
      expect(generateSoftMotionArtifacts(project)).toBe(project)
    })

    it('handles a remote device with no ethercatConfig', () => {
      const project = makeProject([])
      project.remoteDevices = [{ name: 'ec', protocol: 'ethercat' }]
      expect(generateSoftMotionArtifacts(project)).toBe(project)
    })

    it('skips an enabled device whose mandatory objects are unmapped', () => {
      const dev = makeDevice('X_Axis')
      dev.channelMappings = [] // nothing resolves -> no controlWord/statusWord
      const project = makeProject([dev])
      expect(generateSoftMotionArtifacts(project)).toBe(project)
    })

    it('skips a device whose channelInfo is absent', () => {
      const dev = makeDevice('X_Axis')
      dev.channelInfo = undefined
      const project = makeProject([dev])
      expect(generateSoftMotionArtifacts(project)).toBe(project)
    })

    it('deduplicates axes that sanitize to the same identifier', () => {
      const a = makeDevice('X Axis')
      const b = makeDevice('X_Axis') // both -> X_Axis
      a.id = 'a'
      b.id = 'b'
      const out = generateSoftMotionArtifacts(makeProject([a, b]))
      const axisGlobals = out.configurations.resource.globalVariables.filter((g) => g.name === 'X_Axis')
      expect(axisGlobals).toHaveLength(1)
    })

    it('handles a project with no remoteDevices field', () => {
      const project = makeProject([])
      delete project.remoteDevices
      expect(generateSoftMotionArtifacts(project)).toBe(project)
    })

    it('emits fractional scale factors verbatim', () => {
      const dev = makeDevice('X_Axis')
      dev.cia402 = { enabled: true, scaleNum: 1, scaleDenom: 1, scaleFactor: 0.5 }
      const out = generateSoftMotionArtifacts(makeProject([dev]))
      const body = out.pous.find((p) => p.name === SM3_BRIDGE_POU_NAME)!.body.value as string
      expect(body).toContain('X_Axis.fScalefactor := 0.5;')
    })

    it('creates a fallback cyclic task when the resource has none', () => {
      const project = makeProject([makeDevice('X_Axis')])
      project.configurations.resource.tasks = []
      project.configurations.resource.instances = []
      const out = generateSoftMotionArtifacts(project)
      expect(out.configurations.resource.tasks).toHaveLength(1)
      expect(out.configurations.resource.tasks[0].triggering).toBe('Cyclic')
      expect(out.configurations.resource.instances[0].task).toBe(out.configurations.resource.tasks[0].name)
    })
  })
})
