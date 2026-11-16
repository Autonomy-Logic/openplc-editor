import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { createGsdmlXmlLibraryParser } from '../gsdml-xml'
import { GSDML_XML_ENTITY_LIMITS, parseGsdml } from '../index'
import {
  expectCatalog,
  expectError,
  gsdmlFixturePath,
  readGsdmlFixture,
  replaceOnce,
  timed,
} from './fixtures/gsdml-fixtures'

const TIME_LIMIT_MS = 2000
const XXE_MARKER = 'XXE-TARGET-MARKER-5d1c0b'
const BASE = readGsdmlFixture('structural-base.gsdml.xml')
const XML_DECLARATION = '<?xml version="1.0" encoding="utf-8"?>\n'
const ATTACK_FIXTURES = [
  'xxe-system',
  'xxe-public-url',
  'parameter-entity',
  'repeated-doctype',
  'lowercase-doctype',
  'billion-laughs',
  'quadratic-blowup',
]

/** The structural base file with `doctype` after the XML declaration and `value` as the device InfoText. */
function baseWithDoctype(doctype: string, value: string): string {
  const withValue = replaceOnce(BASE, 'Value="Base device"', `Value="${value}"`)
  return replaceOnce(withValue, XML_DECLARATION, `${XML_DECLARATION}${doctype}\n`)
}

/** A document whose external entity points at a local file holding a marker. */
function xxeToLocalFile(): string {
  const target = pathToFileURL(gsdmlFixturePath('attack', 'xxe-target.dat')).href
  return baseWithDoctype(`<!DOCTYPE ISO15745Profile [<!ENTITY xxe SYSTEM "${target}">]>`, '&xxe;')
}

/** The root folder of the installed fast-xml-parser package. */
function installedXmlLibraryRoot(): string {
  let folder = dirname(createRequire(__filename).resolve('fast-xml-parser'))
  while (!existsSync(join(folder, 'package.json')) || readPackageJson(folder).get('name') !== 'fast-xml-parser') {
    const parent = dirname(folder)
    if (parent === folder) throw new Error('fast-xml-parser package root not found')
    folder = parent
  }
  return folder
}

/** The own fields of a JSON object; throws for any other value. */
function jsonFields(value: unknown, what: string): Map<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${what} is not an object`)
  return new Map<string, unknown>(Object.entries(value))
}

/** The top-level fields of the package.json of a folder. */
function readPackageJson(folder: string): Map<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf-8'))
  return jsonFields(parsed, `package.json in ${folder}`)
}

/** Compares two x.y.z versions numerically. */
function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number)
  const right = b.split('.').map(Number)
  for (let i = 0; i < 3; i += 1) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

describe('NFR05: any DOCTYPE is rejected before the XML library runs', () => {
  it.each(ATTACK_FIXTURES)('rejects the %s fixture, naming the DOCTYPE, in under 2 seconds', (name) => {
    const xml = readGsdmlFixture('attack', `${name}.gsdml.xml`)
    const outcome = timed(() => parseGsdml(xml))
    if (outcome.threw) throw new Error(`parseGsdml threw: ${String(outcome.error)}`)
    expect(expectError(outcome.value)).toMatch(/DOCTYPE/i)
    expect(outcome.ms).toBeLessThan(TIME_LIMIT_MS)
  })

  it.each([
    '<!DOCTYPE ISO15745Profile>',
    '<!doctype ISO15745Profile>',
    '<!DocType ISO15745Profile>',
    '<!DOCTYPE ISO15745Profile SYSTEM "GSDML-DeviceProfile.dtd">',
  ])('rejects %s, which declares no entity, naming the DOCTYPE', (doctype) => {
    expect(expectError(parseGsdml(baseWithDoctype(doctype, 'Base device')))).toMatch(/DOCTYPE/i)
  })

  it('never reads the local file an external entity points at', () => {
    const result = parseGsdml(xxeToLocalFile())
    expect(expectError(result)).toMatch(/DOCTYPE/i)
    expect(JSON.stringify(result)).not.toContain(XXE_MARKER)
  })
})

describe('SC2: the configured XML library parser keeps the entity limits on its own', () => {
  it('sets every limit to a finite positive number', () => {
    const entries = Object.entries(GSDML_XML_ENTITY_LIMITS)
    expect(entries.length).toBeGreaterThan(0)
    for (const [option, limit] of entries) {
      expect([option, Number.isFinite(limit) && limit > 0]).toEqual([option, true])
    }
  })

  it('names only options of the pinned library and sets every entity limit it defines', () => {
    const root = installedXmlLibraryRoot()
    const types = readPackageJson(root).get('types')
    if (typeof types !== 'string') throw new Error('fast-xml-parser package.json has no types entry')
    const definitions = readFileSync(join(root, types), 'utf-8')
    const entityOptions = /type ProcessEntitiesOptions = \{([\s\S]*?)\n\};/.exec(definitions)
    if (entityOptions === null) throw new Error('ProcessEntitiesOptions not found in the type definitions')
    const entityLimits = [...entityOptions[1].matchAll(/(max\w+)\?:\s*number;/g)].map((match) => match[1])
    expect(entityLimits.length).toBeGreaterThan(0)
    for (const option of entityLimits) expect(Object.keys(GSDML_XML_ENTITY_LIMITS)).toContain(option)
    for (const option of Object.keys(GSDML_XML_ENTITY_LIMITS)) {
      expect([option, definitions.includes(`${option}?: number;`)]).toEqual([option, true])
    }
  })

  it.each([
    ['billion-laughs', 3 * 10 ** 9],
    ['quadratic-blowup', 20_000 * 5_000],
  ])(
    'throws a limit error on %s or returns without the fully expanded text, in under 2 seconds',
    (name, expandedLength) => {
      const xml = readGsdmlFixture('attack', `${name}.gsdml.xml`)
      const outcome = timed(() => createGsdmlXmlLibraryParser().parse(xml))
      expect(outcome.ms).toBeLessThan(TIME_LIMIT_MS)
      if (outcome.threw) {
        expect(outcome.error).toBeInstanceOf(Error)
        expect(String(outcome.error)).toMatch(/exceed|limit|entit/i)
      } else {
        expect(JSON.stringify(outcome.value).length).toBeLessThan(expandedLength / 10)
      }
    },
  )

  it('never resolves an external SYSTEM entity', () => {
    const outcome = timed(() => createGsdmlXmlLibraryParser().parse(xxeToLocalFile()))
    if (!outcome.threw) expect(JSON.stringify(outcome.value)).not.toContain(XXE_MARKER)
    expect(readFileSync(gsdmlFixturePath('attack', 'xxe-target.dat'), 'utf-8')).toContain(XXE_MARKER)
  })
})

describe('NFR05: predefined entities and numeric character references', () => {
  it('decodes at least 10,000 of them in one file', () => {
    const xml = readGsdmlFixture('bulk-char-refs.gsdml.xml')
    const references = xml.match(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g) ?? []
    expect(references.length).toBeGreaterThanOrEqual(10_000)
    const catalog = expectCatalog(parseGsdml(xml))
    expect(catalog.identity.infoText).toBe('&<>"\'ABé'.repeat(1300))
  })
})

describe('SC1: the parser modules reach no file, network or fetch API', () => {
  it('imports no fs, http, https or net module and calls no fetch', () => {
    const folder = join(__dirname, '..')
    const sources = readdirSync(folder).filter((file) => file.endsWith('.ts'))
    expect(sources).toContain('gsdml-parser.ts')
    const forbidden = /(from\s+|require\(\s*|import\(\s*)['"](node:)?(fs|http|https|net)(\/[^'"]*)?['"]|\bfetch\s*\(/
    const offenders = sources.filter((file) => forbidden.test(readFileSync(join(folder, file), 'utf-8')))
    expect(offenders).toEqual([])
  })
})

describe('SC6: fast-xml-parser is pinned to one exact version', () => {
  it('declares an exact version of at least 5.10.1 and has that version installed', () => {
    const repository = readPackageJson(join(__dirname, '..', '..', '..', '..', '..'))
    const declared = jsonFields(repository.get('dependencies'), 'dependencies').get('fast-xml-parser')
    if (typeof declared !== 'string') throw new Error('fast-xml-parser is not a dependency')
    expect(declared).toMatch(/^\d+\.\d+\.\d+$/)
    expect(compareVersions(declared, '5.10.1')).toBeGreaterThanOrEqual(0)
    expect(readPackageJson(installedXmlLibraryRoot()).get('version')).toBe(declared)
  })
})
