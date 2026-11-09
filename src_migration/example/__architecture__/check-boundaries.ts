import * as ts from 'typescript'

import {
  ALLOWED_ENTRIES,
  ALLOWED_PACKAGES,
  type Entry,
  type Layer,
  LAYERS,
  PUBLIC_ENTRIES,
  STYLE_LAYERS,
  TEST_ENTRIES,
  TEST_PACKAGES,
} from './rules'

/** A source file with its path relative to the example root, using `/` separators. */
export interface ExampleSource {
  readonly path: string
  readonly text: string
}

export interface BoundaryViolation {
  readonly file: string
  readonly specifier: string
  readonly reason: string
}

const TEST_FILE = /(^|\/)__tests__\/|\.test\.tsx?$/

// `domain/index.ts`, `domain/index` and `domain` all name the same public entry.
function stripExtension(path: string): string {
  return path.replace(/\.(tsx?|css)$/, '').replace(/\/index$/, '')
}

// Resolves `.` and `..` segments; returns null when the path climbs above the example root.
function normalize(segments: readonly string[]): string[] | null {
  const result: string[] = []
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (result.length === 0) return null
      result.pop()
    } else {
      result.push(segment)
    }
  }
  return result
}

/** Returns the layer a path belongs to, or null when it sits outside every layer. */
export function classify(path: string): Layer | null {
  return LAYERS.find((layer) => path === layer || path.startsWith(`${layer}/`)) ?? null
}

function entryOf(target: string): Entry | null {
  return PUBLIC_ENTRIES.find((entry) => target === entry) ?? null
}

// Returns the reason an import is forbidden, or null when it is allowed.
function checkImport(file: string, layer: Layer, isTest: boolean, specifier: string): string | null {
  // Bare specifiers are packages (or aliases); relative ones are files inside the example.
  if (!specifier.startsWith('.')) {
    if (specifier.startsWith('@root')) return 'the legacy @root alias is forbidden'
    const allowed = [...ALLOWED_PACKAGES[layer], ...(isTest ? TEST_PACKAGES : [])]
    return allowed.includes(specifier) ? null : `package "${specifier}" is not allowed in ${layer}`
  }

  const directory = file.split('/').slice(0, -1)
  const resolved = normalize([...directory, ...specifier.split('/')])
  if (!resolved) return 'imports outside src_migration/example are forbidden'
  const target = resolved.join('/')

  if (target.endsWith('.css') && !STYLE_LAYERS.includes(layer)) return 'stylesheets belong to design-system'

  const targetLayer = classify(target)
  if (!targetLayer) return `"${target}" is not part of any layer`
  if (targetLayer === layer) return null

  const entry = entryOf(stripExtension(target))
  if (!entry) return `"${target}" is private to ${targetLayer}; import its public entry`
  const allowed = [...ALLOWED_ENTRIES[layer], ...(isTest ? TEST_ENTRIES : [])]
  return allowed.includes(entry) ? null : `${layer} may not depend on ${entry}`
}

/**
 * Checks every import of every source against `rules.ts`. Uses the TypeScript pre-processor, so static
 * imports, type imports, re-exports, dynamic `import()` and `require` are all seen. Pure: no file access.
 */
export function checkBoundaries(sources: readonly ExampleSource[]): BoundaryViolation[] {
  const violations: BoundaryViolation[] = []
  for (const source of sources) {
    const layer = classify(source.path)
    if (!layer) {
      violations.push({ file: source.path, specifier: '', reason: 'file is not part of any layer' })
      continue
    }
    const isTest = TEST_FILE.test(source.path)
    const { importedFiles } = ts.preProcessFile(source.text, true, true)
    for (const { fileName } of importedFiles) {
      const reason = checkImport(source.path, layer, isTest, fileName)
      if (reason) violations.push({ file: source.path, specifier: fileName, reason })
    }
  }
  return violations
}
