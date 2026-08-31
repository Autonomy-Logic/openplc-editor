/**
 * Tests for the pre-compile process-image range guard (openplc-editor#296).
 *
 * The Python editor refused a location past the end of the I/O image with
 * `wrong location for var __QX7_0`; the check was lost in the move to
 * strucpp, so the editor built programs whose I/O silently did nothing.
 * These pin the detector that brings the refusal back, and the message
 * that names the board and the limit.
 */

import type { ProcessImageSizes } from '@root/middleware/shared/utils/target-capabilities'

import type { PLCProjectData } from '../../types/PLC/open-plc'
import {
  describeOutOfRangeLocation,
  FIRMWARE_FALLBACK_PROCESS_IMAGE,
  findOutOfRangeLocations,
} from '../steps/validate-process-image'

type TestVariable = { name: string; location: string; type?: unknown }

/** A located `ARRAY [start..end] OF <base>` variable. */
const arrayVar = (name: string, location: string, start: number, end: number, base = 'WORD'): TestVariable => ({
  name,
  location,
  type: {
    definition: 'array',
    value: `ARRAY [${start}..${end}] OF ${base}`,
    data: { baseType: { definition: 'base-type', value: base }, dimensions: [{ dimension: `${start}..${end}` }] },
  },
})

function makeProject(options: { pous?: Array<{ name: string; variables: TestVariable[] }>; globals?: TestVariable[] }) {
  return {
    pous: (options.pous ?? []).map((pou) => ({
      type: 'program',
      data: {
        name: pou.name,
        language: 'st',
        variables: pou.variables,
        documentation: '',
        body: { language: 'st', value: '' },
      },
    })),
    dataTypes: [],
    configuration: { resource: { tasks: [], instances: [], globalVariables: options.globals ?? [] } },
  } as unknown as PLCProjectData
}

/** A local `VAR … AT` in one POU — the common shape in these tests. */
const withLocal = (location: string, name = 'v') =>
  makeProject({ pous: [{ name: 'main', variables: [{ name, location }] }] })

/** Roomy enough that nothing here trips a bound by accident. */
const BIG_IMAGE: ProcessImageSizes = {
  digitalInputs: 240,
  digitalOutputs: 240,
  analogInputs: 64,
  analogOutputs: 64,
  realInputs: 64,
  realOutputs: 64,
  memoryWords: 128,
  memoryDwords: 32,
  memoryLwords: 32,
}

describe('findOutOfRangeLocations — bounds per area', () => {
  it('accepts the last slot and rejects the one past it', () => {
    // 56 digital outputs => %QX0.0..%QX6.7 (slots 0..55). %QX7.0 is slot
    // 56 — the exact address from the issue report.
    expect(findOutOfRangeLocations(withLocal('%QX6.7'), undefined)).toEqual([])

    const issues = findOutOfRangeLocations(withLocal('%QX7.0'), undefined)
    expect(issues).toEqual([
      {
        scope: 'main',
        variableName: 'v',
        location: '%QX7.0',
        slot: 56,
        capacity: 56,
        area: '%QX (digital outputs)',
        slotCount: 1,
      },
    ])
  })

  it.each([
    ['%IX7.0', 'digitalInputs', '%IX (digital inputs)'],
    ['%QX7.0', 'digitalOutputs', '%QX (digital outputs)'],
    ['%IW32', 'analogInputs', '%IW (analog inputs)'],
    ['%QW32', 'analogOutputs', '%QW (analog outputs)'],
    ['%ID32', 'realInputs', '%ID (analog inputs, REAL)'],
    ['%QD32', 'realOutputs', '%QD (analog outputs, REAL)'],
    ['%MW20', 'memoryWords', '%MW (memory words)'],
    ['%MD20', 'memoryDwords', '%MD (memory double words)'],
    ['%ML20', 'memoryLwords', '%ML (memory long words)'],
  ])('bounds %s against %s', (location, _field, area) => {
    const issues = findOutOfRangeLocations(withLocal(location), undefined)
    expect(issues).toHaveLength(1)
    expect(issues[0]?.area).toBe(area)
  })

  it('counts a bit address as byte*8 + bit, not as its byte', () => {
    // %QX7.0 and %QX7.7 are both past a 56-slot image, but they are
    // different slots — a message quoting the byte would say "7" for both.
    expect(findOutOfRangeLocations(withLocal('%QX7.7'), undefined)[0]?.slot).toBe(63)
  })
})

describe('findOutOfRangeLocations — which image applies', () => {
  it('uses the firmware fallback when the target declares no image', () => {
    expect(FIRMWARE_FALLBACK_PROCESS_IMAGE.digitalOutputs).toBe(56)
    expect(findOutOfRangeLocations(withLocal('%QX7.0'), undefined)).toHaveLength(1)
  })

  it('accepts what a declared, larger image makes room for', () => {
    // The whole point of openplc-editor#296: a P1AM-sized image makes the
    // address that fails above legal.
    expect(findOutOfRangeLocations(withLocal('%QX7.0'), BIG_IMAGE)).toEqual([])
    expect(findOutOfRangeLocations(withLocal('%MW126'), BIG_IMAGE)).toEqual([])
  })

  it('rejects what a declared, smaller image takes away', () => {
    const tiny: ProcessImageSizes = { ...BIG_IMAGE, memoryWords: 0 }
    expect(findOutOfRangeLocations(withLocal('%MW0'), tiny)).toHaveLength(1)
  })
})

describe('findOutOfRangeLocations — what it scans', () => {
  it('checks CONFIGURATION globals as well as POU locals', () => {
    const issues = findOutOfRangeLocations(makeProject({ globals: [{ name: 'g', location: '%QX7.0' }] }), undefined)
    expect(issues).toEqual([expect.objectContaining({ scope: 'Global Variables', variableName: 'g' })])
  })

  it('reports every offender, not just the first', () => {
    const issues = findOutOfRangeLocations(
      makeProject({
        pous: [
          {
            name: 'main',
            variables: [
              { name: 'a', location: '%QX7.0' },
              { name: 'b', location: '%MW99' },
            ],
          },
        ],
        globals: [{ name: 'c', location: '%IW40' }],
      }),
      undefined,
    )
    expect(issues.map((i) => i.variableName)).toEqual(['a', 'b', 'c'])
  })

  it('ignores unlocated variables, local and global alike', () => {
    expect(findOutOfRangeLocations(withLocal(''), undefined)).toEqual([])
    expect(findOutOfRangeLocations(makeProject({ globals: [{ name: 'g', location: '' }] }), undefined)).toEqual([])
  })

  it('ignores an unresolved alias — a name, not an address', () => {
    // Aliases are resolved to literals by getCompileReadyProjectData()
    // before the pipeline runs. One still standing here resolved to
    // nothing, which makes the variable unlocated, not out of range.
    expect(findOutOfRangeLocations(withLocal('MotorStart'), undefined)).toEqual([])
  })

  it.each(['%IB0', '%QB99', '%MB99', '%MX99.0'])(
    'ignores %s — the Arduino firmware has no buffer for that area',
    (location) => {
      expect(findOutOfRangeLocations(withLocal(location), undefined)).toEqual([])
    },
  )
})

describe('findOutOfRangeLocations — located arrays', () => {
  // A located array occupies one slot per element (openplc-editor#565), so
  // the base address fitting says nothing about whether the array does.
  const withArray = (location: string, start: number, end: number, base?: string) =>
    makeProject({ pous: [{ name: 'main', variables: [arrayVar('buffer', location, start, end, base)] }] })

  it('measures the last element, not the base address', () => {
    // %MW0 is fine; %MW0..%MW66 is not, against a 20-word fallback image.
    const issues = findOutOfRangeLocations(withArray('%MW0', 0, 66), undefined)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ slot: 66, capacity: 20, slotCount: 67 })
  })

  it('accepts an array that ends exactly at the last slot', () => {
    expect(findOutOfRangeLocations(withArray('%MW0', 0, 19), undefined)).toEqual([])
    expect(findOutOfRangeLocations(withArray('%MW0', 0, 20), undefined)).toHaveLength(1)
  })

  it('accepts the issue’s own declaration once the target has room for it', () => {
    // `HR_myData AT %MW60 : ARRAY [0..66] OF WORD` — needs %MW60..%MW126.
    expect(findOutOfRangeLocations(withArray('%MW60', 0, 66), undefined)).toHaveLength(1)
    expect(findOutOfRangeLocations(withArray('%MW60', 0, 66), BIG_IMAGE)).toEqual([])
  })

  it('counts a bit array in bits, crossing byte boundaries', () => {
    // 240 outputs = slots 0..239. Starting at %QX29.0 (slot 232), 8 bits
    // exactly fill it; 9 do not.
    expect(findOutOfRangeLocations(withArray('%QX29.0', 0, 7, 'BOOL'), BIG_IMAGE)).toEqual([])
    expect(findOutOfRangeLocations(withArray('%QX29.0', 0, 8, 'BOOL'), BIG_IMAGE)).toHaveLength(1)
  })

  it.each([
    ['a multi-dimensional array', [{ dimension: '0..3' }, { dimension: '0..3' }]],
    ['a malformed dimension', [{ dimension: 'N..M' }]],
    ['no dimensions at all', []],
  ])('falls back to one slot for %s rather than guessing', (_label, dimensions) => {
    // Under-counting costs at most a missed diagnostic (the compiler rejects
    // these shapes anyway); guessing high would refuse a valid build.
    const project = makeProject({
      pous: [
        {
          name: 'main',
          variables: [
            {
              name: 'buffer',
              location: '%MW0',
              type: {
                definition: 'array',
                value: 'ARRAY [...] OF WORD',
                data: { baseType: { definition: 'base-type', value: 'WORD' }, dimensions },
              },
            },
          ],
        },
      ],
    })
    expect(findOutOfRangeLocations(project, undefined)).toEqual([])
  })

  it('treats an array with no data block as a single slot', () => {
    const project = makeProject({
      pous: [
        {
          name: 'main',
          variables: [
            { name: 'buffer', location: '%MW0', type: { definition: 'array', value: 'ARRAY [0..66] OF WORD' } },
          ],
        },
      ],
    })
    expect(findOutOfRangeLocations(project, undefined)).toEqual([])
  })
})

describe('describeOutOfRangeLocation', () => {
  it('names the board, the slot, the area and the last usable slot', () => {
    const [issue] = findOutOfRangeLocations(withLocal('%QX7.0', 'coil'), undefined)
    expect(issue).toBeDefined()
    // Non-null assertion avoided: the expect above already proved it, but
    // TS needs the guard to narrow.
    if (!issue) throw new Error('expected an issue')
    expect(describeOutOfRangeLocation(issue, 'AutomationDirect P1AM-100')).toBe(
      'main: variable "coil" is located at %QX7.0, which is slot 56 of %QX (digital outputs) — ' +
        '"AutomationDirect P1AM-100" supports 56 (last usable: slot 55).',
    )
  })

  it('says the area is absent rather than quoting "last usable: slot -1"', () => {
    const [issue] = findOutOfRangeLocations(withLocal('%MW0'), { ...BIG_IMAGE, memoryWords: 0 })
    if (!issue) throw new Error('expected an issue')
    expect(describeOutOfRangeLocation(issue, 'Arduino Uno')).toContain('"Arduino Uno" has no %MW (memory words) area')
  })

  it('blames the array’s length, not its (legal) base address', () => {
    const [issue] = findOutOfRangeLocations(
      makeProject({ pous: [{ name: 'main', variables: [arrayVar('buffer', '%MW0', 0, 66)] }] }),
      undefined,
    )
    if (!issue) throw new Error('expected an issue')
    expect(describeOutOfRangeLocation(issue, 'Arduino Mega')).toBe(
      'main: variable "buffer" is located at %MW0, whose 67 elements reach slot 66 of %MW (memory words) — ' +
        '"Arduino Mega" supports 20 (last usable: slot 19).',
    )
  })
})
