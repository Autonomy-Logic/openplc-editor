/**
 * scripts/package-trust: the trust module generator, its single entry point and runtime imports, the module loader,
 * the release seed and the fingerprint check, run in process.
 * @jest-environment node
 */
import { createPublicKey } from 'node:crypto'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals'
import ts from 'typescript'

import { checkFingerprint } from '../../scripts/package-trust/fingerprint'
import {
  CROSS_SEED_PROBE,
  DEVELOPMENT_SEED,
  deriveReleaseSeed,
  generatePackageTrustModule,
  shareLiteralsFromSource,
} from '../../scripts/package-trust/generator'
import { loadTrustModule } from '../../scripts/package-trust/load-module'
import { pemToDer, signTestPackage } from '../backend/editor/package-trust/__tests__/fixtures/sign-test-package'
import {
  COMMITTED_MODULE_PATH,
  developmentModule,
  FALLBACK_TYPES_IMPORT,
  FALLBACK_VERIFIER_IMPORT,
  flipCharacter,
  generateTestModule,
  type GeneratedModule,
  loadModule,
  moduleImports,
  NODE_IMPORTS,
  recordingCrypto,
  RELEASE_TYPES_IMPORT,
  RELEASE_VERIFIER_IMPORT,
  replaceLiteral,
  SEED_A,
  SEED_B,
  TEST_AUTONOMY_KEY,
  TEST_KEYS,
  testSeeds,
  toHex,
  wideningVerifier,
} from '../backend/editor/package-trust/__tests__/fixtures/trust-test-kit'
import { TRUSTED_PACKAGE_KEYS } from '../backend/shared/utils/vpp/trusted-keys'

const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
const VERSION = '4.3.5'
const COMMIT = 'b657afce48407566c1bcba9d94cb9fe359855428'
const RELEASE_SEED = '3ee6b0137153fce5144d02aacebac13284f0b980cc28efd0da8c6ceee4faaa6e'
const TIMEOUT = 300000

/** Names that identify the trust path in a bundle, the same in every release; no generated module may hold one. */
const FORBIDDEN_NAMES = [
  'checkAtImport',
  'checkAtUse',
  'trustedKeys',
  'verifyFileSet',
  'verifyManifestIdentity',
  'verifyEd25519',
  'readSnapshot',
  '.anchor.',
]

const SEEDS = [SEED_A, SEED_B, ...testSeeds(50)]
const modules: GeneratedModule[] = SEEDS.map((seed) => generateTestModule(seed))

/** The hex seeds whose module fails @p passes. */
function failingSeeds(passes: (module: GeneratedModule) => boolean): string[] {
  return modules.filter((module) => !passes(module)).map((module) => toHex(module.seed))
}

/** Every 8-byte window of @p bytes, as lowercase hex. */
function hexWindows(bytes: Uint8Array): string[] {
  return Array.from({ length: bytes.length - 7 }, (_, start) => toHex(bytes.slice(start, start + 8)))
}

/** The text forms of a key and its id that must not appear in a generated module (M2). */
function keyForms(keyId: string, pem: string): string[] {
  const der = new Uint8Array(createPublicKey(pem).export({ format: 'der', type: 'spki' }))
  const raw = der.slice(der.length - 32)
  const body = pem.replace(/-----[^-]+-----/g, '').trim()
  const encode = (bytes: Uint8Array, encoding: BufferEncoding): string => Buffer.from(bytes).toString(encoding)
  return [
    keyId,
    encode(new TextEncoder().encode(keyId), 'hex'),
    encode(new TextEncoder().encode(keyId), 'base64').replace(/=+$/, ''),
    '-----BEGIN',
    'PUBLIC KEY',
    body,
    body.replace(/\s+/g, ''),
    JSON.stringify(pem).slice(1, -1),
    encode(der, 'base64').replace(/=+$/, ''),
    encode(raw, 'base64').replace(/=+$/, ''),
    encode(raw, 'base64url'),
    encode(raw, 'latin1'),
    encode(der, 'hex'),
    ...hexWindows(raw),
  ]
}

/** The forms of @p keys found in @p source; hex is matched without regard to case. */
function leakedKeyForms(source: string, keys: Record<string, string>): string[] {
  const lower = source.toLowerCase()
  return Object.entries(keys)
    .flatMap(([keyId, pem]) => keyForms(keyId, pem))
    .filter((form) => source.includes(form) || (/^[0-9a-f]+$/.test(form) && lower.includes(form)))
}

/** What a module source exports and imports, read from its syntax tree. */
interface ModuleShape {
  /** The identifier of `export default <name>`, or null. */
  defaultExport: string | null
  /** Every other export, as the statement kind that makes it. */
  otherExports: string[]
  /** Specifier -> imported names, for imports that load a module at runtime. */
  runtimeImports: Record<string, string[]>
  /** Specifiers of type-only imports. */
  typeImports: string[]
  /** Calls of require() or import(). */
  dynamicLoads: number
}

function moduleShape(source: string): ModuleShape {
  const file = ts.createSourceFile('package-trust-anchor.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const shape: ModuleShape = {
    defaultExport: null,
    otherExports: [],
    runtimeImports: {},
    typeImports: [],
    dynamicLoads: 0,
  }
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : '?'
      const clause = statement.importClause
      if (clause?.isTypeOnly) {
        shape.typeImports.push(specifier)
        continue
      }
      const names: string[] = []
      if (clause?.name) names.push('default')
      const bindings = clause?.namedBindings
      if (bindings && ts.isNamespaceImport(bindings)) names.push('*')
      if (bindings && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          if (!element.isTypeOnly) names.push((element.propertyName ?? element.name).text)
        }
      }
      if (names.length > 0 || clause === undefined) {
        shape.runtimeImports[specifier] = [...(shape.runtimeImports[specifier] ?? []), ...names]
      } else {
        shape.typeImports.push(specifier)
      }
    } else if (ts.isExportAssignment(statement)) {
      if (!statement.isExportEquals && ts.isIdentifier(statement.expression)) {
        if (shape.defaultExport === null) shape.defaultExport = statement.expression.text
        else shape.otherExports.push('a second export default')
      } else {
        shape.otherExports.push('export = or export default <expression>')
      }
    } else if (ts.isExportDeclaration(statement)) {
      shape.otherExports.push('export {} or export * from')
    } else if (
      ts.canHaveModifiers(statement) &&
      (ts.getModifiers(statement) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      shape.otherExports.push(ts.SyntaxKind[statement.kind])
    }
  }
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ((ts.isIdentifier(node.expression) && node.expression.text === 'require') ||
        node.expression.kind === ts.SyntaxKind.ImportKeyword)
    ) {
      shape.dynamicLoads += 1
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return shape
}

/** The problems of @p module's exports and imports against the contract of a generated module. */
function shapeProblems({ source, layout }: GeneratedModule, typesImport: string, verifierImport: string): string[] {
  const shape = moduleShape(source)
  const allowed = new Set<string>([...NODE_IMPORTS, verifierImport])
  const problems: string[] = []
  if (shape.defaultExport === null || shape.defaultExport !== layout.entryName) {
    problems.push(`default export ${String(shape.defaultExport)}, layout entry ${layout.entryName}`)
  }
  problems.push(...shape.otherExports.map((kind) => `other export: ${kind}`))
  problems.push(...[/^export const /m, /^export function /m, /^export \{/m].filter((p) => p.test(source)).map(String))
  for (const [specifier, names] of Object.entries(shape.runtimeImports)) {
    if (!allowed.has(specifier)) problems.push(`runtime import of ${specifier}`)
  }
  const verifierNames = shape.runtimeImports[verifierImport] ?? []
  if (JSON.stringify(verifierNames) !== JSON.stringify(['verifyPackageSignature'])) {
    problems.push(`imports ${verifierNames.join(', ')} from the shared verifier`)
  }
  problems.push(...shape.typeImports.filter((specifier) => specifier !== typesImport).map((s) => `type import ${s}`))
  if (shape.dynamicLoads > 0) problems.push(`${shape.dynamicLoads} require() or import() call(s)`)
  return problems
}

/** At most @p count items of @p items, evenly spread, first and last included. */
function evenly<T>(items: T[], count: number): T[] {
  if (items.length <= count) return items
  return Array.from({ length: count }, (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))])
}

/** The forbidden names @p source holds. */
const forbiddenIn = (source: string): string[] => FORBIDDEN_NAMES.filter((name) => source.includes(name))

describe('generatePackageTrustModule', () => {
  it('gives byte-identical source and the same layout for the same options', () => {
    const options = {
      seed: SEED_A,
      keys: TEST_KEYS,
      typesImport: FALLBACK_TYPES_IMPORT,
      verifierImport: FALLBACK_VERIFIER_IMPORT,
      header: { mode: 'development' },
    } as const

    expect(generatePackageTrustModule(options)).toEqual(generatePackageTrustModule(options))
  })

  it('puts the version and the commit in the first line of a release module only', () => {
    const release = generatePackageTrustModule({
      seed: SEED_A,
      keys: TEST_KEYS,
      typesImport: FALLBACK_TYPES_IMPORT,
      verifierImport: FALLBACK_VERIFIER_IMPORT,
      header: { mode: 'release', version: VERSION, commit: COMMIT },
    }).source.split('\n')[0]
    const development = generateTestModule(SEED_A).source.split('\n')[0]

    expect([release.includes(VERSION), release.includes(COMMIT)]).toEqual([true, true])
    expect([development.includes(VERSION), development.includes(COMMIT)]).toEqual([false, false])
  })

  it('exports exactly one binding, export default <layout.entryName>, for every seed', () => {
    const problems = modules
      .map((module) => ({
        seed: toHex(module.seed),
        problems: shapeProblems(module, FALLBACK_TYPES_IMPORT, FALLBACK_VERIFIER_IMPORT),
      }))
      .filter((entry) => entry.problems.length > 0)

    expect(problems).toEqual([])
  })

  it('imports at runtime only node:crypto, node:fs, node:path and verifyPackageSignature from verifierImport', () => {
    const release = generatePackageTrustModule({
      seed: SEED_B,
      keys: TEST_KEYS,
      typesImport: RELEASE_TYPES_IMPORT,
      verifierImport: RELEASE_VERIFIER_IMPORT,
      header: { mode: 'release', version: VERSION, commit: COMMIT },
    })
    const shape = moduleShape(release.source)

    expect(shapeProblems({ seed: SEED_B, ...release }, RELEASE_TYPES_IMPORT, RELEASE_VERIFIER_IMPORT)).toEqual([])
    expect(shape.runtimeImports[RELEASE_VERIFIER_IMPORT]).toEqual(['verifyPackageSignature'])
    expect(shape.typeImports).toEqual([RELEASE_TYPES_IMPORT])
  })

  it('the committed fallback exports only its default and imports only the allowed modules', () => {
    const committed = readFileSync(COMMITTED_MODULE_PATH, 'utf-8')

    expect(
      shapeProblems({ ...developmentModule(), source: committed }, FALLBACK_TYPES_IMPORT, FALLBACK_VERIFIER_IMPORT),
    ).toEqual([])
  })

  it('the committed fallback is the development module, byte for byte (drift)', () => {
    expect(readFileSync(COMMITTED_MODULE_PATH, 'utf-8')).toBe(developmentModule().source)
  })

  it('ABUSE-08: two seeds give different encoded key shares, site functions and entry names', () => {
    const [a, b] = modules

    expect(a.layout.shareLiterals.filter((literal) => b.layout.shareLiterals.includes(literal))).toEqual([])
    expect(b.layout.sites).not.toEqual(a.layout.sites)
    expect(b.layout.entryName).not.toBe(a.layout.entryName)
  })

  it('gives a different entry name to most seeds', () => {
    expect(new Set(modules.map((module) => module.layout.entryName)).size).toBeGreaterThan(modules.length / 2)
  })

  it('binds at least two sites to each hook, for every seed', () => {
    const failing = failingSeeds((module) =>
      ['import', 'use'].every((hook) => module.layout.sites.filter((site) => site.hook === hook).length >= 2),
    )

    expect(failing).toEqual([])
  })

  it('names in its layout share literals of letters and digits and functions that are in the source', () => {
    const failing = failingSeeds(
      ({ source, layout }) =>
        layout.shareLiterals.length > 0 &&
        layout.shareLiterals.every((literal) => /^[A-Za-z0-9]+$/.test(literal) && source.includes(literal)) &&
        [layout.entryName, ...layout.sites.map((site) => site.functionName)].every((name) =>
          new RegExp(`\\b${name}\\b`).test(source),
        ),
    )

    expect(failing).toEqual([])
  })

  it('hosts the sites and the entry point in functions whose names do not tell what they do', () => {
    const failing = failingSeeds(({ layout }) =>
      [layout.entryName, ...layout.sites.map((site) => site.functionName)].every(
        (name) => !/trust|canary|verif|signature|publickey|anchor|autonomy|check|snapshot/i.test(name),
      ),
    )

    expect(failing).toEqual([])
  })

  it('P1: holds none of the fixed trust names, for every seed and in the committed fallback', () => {
    const leaks = [
      ...modules.map((module) => ({ seed: toHex(module.seed), names: forbiddenIn(module.source) })),
      { seed: 'committed fallback', names: forbiddenIn(readFileSync(COMMITTED_MODULE_PATH, 'utf-8')) },
    ].filter((entry) => entry.names.length > 0)

    expect(leaks).toEqual([])
  })

  it('AC3: holds no form of the key or its id, for every seed', () => {
    const leaks = modules
      .map((module) => ({ seed: toHex(module.seed), leaked: leakedKeyForms(module.source, TEST_KEYS) }))
      .filter((entry) => entry.leaked.length > 0)

    expect(leaks).toEqual([])
  })

  it('AC3: the development module holds no form of the Autonomy key or its id', () => {
    expect(leakedKeyForms(developmentModule().source, TRUSTED_PACKAGE_KEYS)).toEqual([])
  })

  it('ABUSE-09: holds no form of the seed, for every seed', () => {
    const failing = failingSeeds(({ seed, source }) => {
      const lower = source.toLowerCase()
      const forms = [Buffer.from(seed).toString('base64').replace(/=+$/, ''), ...hexWindows(seed)]
      return forms.every((form) => !source.includes(form) && !lower.includes(form.toLowerCase()))
    })

    expect(failing).toEqual([])
  })
})

describe('CROSS_SEED_PROBE', () => {
  it('is a fixed 32-byte seed that differs from the development seed', () => {
    expect({
      length: CROSS_SEED_PROBE.length,
      development: toHex(CROSS_SEED_PROBE) === toHex(DEVELOPMENT_SEED),
    }).toEqual({ length: 32, development: false })
  })

  it('gives a module whose entry name, sites and share literals differ from the development module', () => {
    const probe = generateTestModule(CROSS_SEED_PROBE, TRUSTED_PACKAGE_KEYS)
    const development = developmentModule()

    expect(probe.layout.entryName).not.toBe(development.layout.entryName)
    expect(probe.layout.sites).not.toEqual(development.layout.sites)
    expect(probe.layout.shareLiterals.filter((literal) => development.layout.shareLiterals.includes(literal))).toEqual(
      [],
    )
  })
})

describe('loadTrustModule', () => {
  const imports = (): Record<string, unknown> => moduleImports(FALLBACK_VERIFIER_IMPORT)

  it('returns the default export of the module, evaluated with the objects given for its imports', () => {
    const source = [
      "import { sep } from 'node:path'",
      'const entry = (dir: string, atImport: boolean) => [atImport, dir, sep]',
      'export default entry',
      '',
    ].join('\n')
    const marked = { ...imports(), 'node:path': { sep: 'from-the-given-object' } }

    expect(loadTrustModule(source, marked)('pkg', true)).toEqual([true, 'pkg', 'from-the-given-object'])
  })

  it.each(['node:os', 'node:child_process', './evil', '../../shared/utils/vpp/package-verification-core'])(
    'refuses a module that imports %s, naming it',
    (specifier) => {
      const source = [
        `import * as other from '${specifier}'`,
        'const entry = (dir: string, atImport: boolean) => [false, String(Object.keys(other).length)]',
        'export default entry',
        '',
      ].join('\n')

      expect(() => loadTrustModule(source, imports())('pkg', true)).toThrow(specifier)
    },
  )

  it('loads the module of every seed to a function', () => {
    const failing = failingSeeds((module) => typeof loadModule(module.source) === 'function')

    expect(failing).toEqual([])
  })
})

describe('shareLiteralsFromSource', () => {
  const sorted = (literals: string[]): string[] => [...literals].sort()

  /** True when the literals read from the source of @p module are the share literals of its layout. */
  const matchesLayout = ({ source, layout }: GeneratedModule): boolean =>
    JSON.stringify(sorted(shareLiteralsFromSource(source))) === JSON.stringify(sorted(layout.shareLiterals))

  /** The release module of @p seed, with the header and the imports generate-release gives it. */
  function releaseModule(seed: Uint8Array): GeneratedModule {
    const { source, layout } = generatePackageTrustModule({
      seed,
      keys: TEST_KEYS,
      typesImport: RELEASE_TYPES_IMPORT,
      verifierImport: RELEASE_VERIFIER_IMPORT,
      header: { mode: 'release', version: VERSION, commit: COMMIT },
    })
    return { seed, source, layout }
  }

  /** Two decoders, declared as the generator declares them. */
  const DECODERS = [
    'function ab1cde(parts: string[]): Uint8Array {',
    '  return new Uint8Array(parts.length)',
    '}',
    '',
    'function zz9yyy(parts: string[]): Uint8Array {',
    '  return new Uint8Array(parts.length)',
    '}',
    '',
  ]

  it('reads the share literals of the layout from the development module of every seed', () => {
    expect(failingSeeds(matchesLayout)).toEqual([])
  })

  it('reads the share literals of the layout from the release module of every seed', () => {
    const failing = SEEDS.map(releaseModule)
      .filter((module) => !matchesLayout(module))
      .map((module) => toHex(module.seed))

    expect(failing).toEqual([])
  })

  it('reads the share literals of the development module from the committed fallback', () => {
    const literals = shareLiteralsFromSource(readFileSync(COMMITTED_MODULE_PATH, 'utf-8'))

    expect(sorted(literals)).toEqual(sorted(developmentModule().layout.shareLiterals))
  })

  it('returns the literals of every decoder call in source order, a multi-line array included', () => {
    const source = [
      ...DECODERS,
      'function qq1aaa(): number {',
      "  const b0 = zz9yyy(['Pa1', 'Pb2'])",
      '  const d0 = ab1cde([',
      "    'Qa1',",
      "    'Qb2',",
      "    'Qc3',",
      '  ])',
      '  return b0.length + d0.length',
      '}',
      '',
    ].join('\n')

    expect(shareLiteralsFromSource(source)).toEqual(['Pa1', 'Pb2', 'Qa1', 'Qb2', 'Qc3'])
  })

  it('returns [] for a source with no decoder call, ignoring other string arrays and calls of other functions', () => {
    const source = [
      ...DECODERS,
      'function rr2bbb(parts: string[]): string {',
      "  return parts.join('')",
      '}',
      '',
      "export const k = ['Ka1', 'Kb2']",
      "export const r = rr2bbb(['Ra1', 'Rb2'])",
      '',
    ].join('\n')

    expect(shareLiteralsFromSource(source)).toEqual([])
  })

  it('reads a source whose evaluation would throw, so it never evaluates it', () => {
    const source = [
      "throw new Error('the source was evaluated')",
      '',
      ...DECODERS,
      "const b0 = ab1cde(['Ea1', 'Eb2'])",
      '',
    ].join('\n')

    expect(shareLiteralsFromSource(source)).toEqual(['Ea1', 'Eb2'])
  })
})

describe('seeds', () => {
  it('derives the release seed as HMAC-SHA256(secret, version+commit)', () => {
    expect(toHex(deriveReleaseSeed(SECRET, VERSION, COMMIT))).toBe(RELEASE_SEED)
  })

  it('has a 32-byte development seed', () => {
    expect(DEVELOPMENT_SEED.length).toBe(32)
  })
})

describe('checkFingerprint', () => {
  let fixtures = ''
  let signed = ''

  beforeAll(() => {
    fixtures = mkdtempSync(join(realpathSync(tmpdir()), 'package-trust-fingerprint-'))
    signed = signTestPackage(join(fixtures, 'signed'), { key: TEST_AUTONOMY_KEY, packageId: 'com.test.valid' }).dir
  })

  afterAll(() => {
    rmSync(fixtures, { recursive: true, force: true })
  })

  /**
   * Every key @p source recombines, as sorted SPKI DER hex: the keys of the map it hands to the shared verifier and
   * the keys of every Ed25519 call it makes at both hooks; 'throws' when loading or calling it throws.
   */
  function recombinedKeys(source: string): string[] | 'throws' {
    try {
      const crypto = recordingCrypto()
      const widening = wideningVerifier()
      const verify = loadModule(source, { crypto: crypto.crypto, verifier: widening.verifier })
      verify(signed, true)
      verify(signed, false)
      const fromMaps = widening.maps.flatMap((map) => Object.values(map).map((pem) => toHex(pemToDer(pem))))
      const fromCalls = crypto.calls.map((call) => toHex(call.key))
      return [...new Set([...fromMaps, ...fromCalls])].sort()
    } catch {
      return 'throws'
    }
  }

  it(
    'passes the module of every seed against the keys it was generated for',
    () => {
      const failing = failingSeeds(({ source }) => checkFingerprint(source, TEST_KEYS).ok)

      expect(failing).toEqual([])
    },
    TIMEOUT,
  )

  it('passes the development module against the Autonomy key', () => {
    expect(checkFingerprint(developmentModule().source, TRUSTED_PACKAGE_KEYS)).toEqual({ ok: true })
  })

  it('fails a module that recombines another key, naming the fingerprint mismatch', () => {
    expect(checkFingerprint(modules[0].source, TRUSTED_PACKAGE_KEYS)).toEqual({
      ok: false,
      error: expect.stringContaining('fingerprint mismatch'),
    })
  })

  it(
    'ABUSE-17: fails a module with one byte of one share flipped that changes a recombined key, naming the fingerprint mismatch',
    () => {
      const targets: [GeneratedModule, Record<string, string>][] = [
        [modules[0], TEST_KEYS],
        [developmentModule(), TRUSTED_PACKAGE_KEYS],
      ]
      const flips: { literal: string; changesKey: boolean; result: ReturnType<typeof checkFingerprint> }[] = []
      for (const [{ source, layout }, keys] of targets) {
        const original = JSON.stringify(recombinedKeys(source))
        for (const literal of evenly(layout.shareLiterals, 60)) {
          const flipped = replaceLiteral(source, literal, flipCharacter(literal))
          const changesKey = JSON.stringify(recombinedKeys(flipped)) !== original
          flips.push({ literal, changesKey, result: checkFingerprint(flipped, keys) })
        }
      }
      const keyFlips = flips.filter((flip) => flip.changesKey)

      expect(keyFlips.length).toBeGreaterThan(0)
      expect(keyFlips.filter((flip) => flip.result.ok || !flip.result.error.includes('fingerprint mismatch'))).toEqual(
        [],
      )
    },
    TIMEOUT,
  )
})
