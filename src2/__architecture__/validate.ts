/**
 * Architecture validation script for the src2/ migration.
 *
 * Scans all .ts/.tsx files in src2/, extracts imports, and validates
 * that dependency rules between architectural layers are respected.
 *
 * Run: npx tsx src2/__architecture__/validate.ts
 * Exit code 0 = pass, 1 = violations found
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Layer definitions
// ---------------------------------------------------------------------------

type LayerName = 'utils' | 'ports' | 'provider' | 'adapters' | 'store' | 'hooks' | 'components' | 'architecture'

interface LayerRule {
  /** Human-readable layer name */
  name: string
  /** Layers this layer is allowed to import from (within src2/) */
  allowedDeps: LayerName[]
}

const LAYER_RULES: Record<LayerName, LayerRule> = {
  utils: {
    name: 'Domain (utils/)',
    allowedDeps: ['utils'],
  },
  ports: {
    name: 'Application — Ports (providers/platform/ports/)',
    allowedDeps: ['utils', 'ports'],
  },
  provider: {
    name: 'Application — Provider (providers/platform/)',
    allowedDeps: ['ports', 'utils'],
  },
  adapters: {
    name: 'Adapters (adapters/)',
    allowedDeps: ['ports', 'provider', 'utils'],
  },
  store: {
    name: 'Store (store/)',
    allowedDeps: ['ports', 'provider', 'store', 'utils'],
  },
  hooks: {
    name: 'Hooks (hooks/)',
    allowedDeps: ['ports', 'provider', 'store', 'hooks', 'utils'],
  },
  components: {
    name: 'Components (components/)',
    allowedDeps: ['ports', 'provider', 'store', 'hooks', 'components', 'utils'],
  },
  architecture: {
    name: 'Architecture (__architecture__/)',
    allowedDeps: [],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC2_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')

function collectFiles(dir: string, ext: string[]): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      results.push(...collectFiles(full, ext))
    } else if (ext.some((e) => full.endsWith(e))) {
      results.push(full)
    }
  }
  return results
}

/** Determine which architectural layer a file belongs to */
function getLayer(filePath: string): LayerName | null {
  const rel = relative(SRC2_ROOT, filePath).replace(/\\/g, '/')

  if (rel.startsWith('__architecture__/')) return 'architecture'

  // Support both frontend/-prefixed and non-prefixed paths
  if (rel.startsWith('frontend/providers/platform/ports/') || rel.startsWith('providers/platform/ports/')) return 'ports'
  if (rel.startsWith('frontend/providers/platform/') || rel.startsWith('providers/platform/')) return 'provider'
  if (rel.startsWith('adapters/')) return 'adapters'
  if (rel.startsWith('frontend/store/') || rel.startsWith('store/')) return 'store'
  if (rel.startsWith('frontend/hooks/') || rel.startsWith('hooks/')) return 'hooks'
  if (rel.startsWith('frontend/components/') || rel.startsWith('components/')) return 'components'
  if (rel.startsWith('frontend/utils/') || rel.startsWith('utils/')) return 'utils'

  return null
}

/** Extract import/export-from paths from a TypeScript source string */
function extractImports(source: string): { path: string; line: number }[] {
  const results: { path: string; line: number }[] = []
  const lines = source.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Static imports: import ... from '...'
    // Re-exports:     export ... from '...'
    const staticMatch = line.match(/(?:import|export)\s+.*?\s+from\s+['"]([^'"]+)['"]/)
    if (staticMatch) {
      results.push({ path: staticMatch[1], line: i + 1 })
      continue
    }

    // Side-effect imports: import '...'
    const sideEffectMatch = line.match(/^\s*import\s+['"]([^'"]+)['"]/)
    if (sideEffectMatch) {
      results.push({ path: sideEffectMatch[1], line: i + 1 })
      continue
    }

    // Dynamic imports: import('...')
    const dynamicMatch = line.match(/import\(\s*['"]([^'"]+)['"]\s*\)/)
    if (dynamicMatch) {
      results.push({ path: dynamicMatch[1], line: i + 1 })
    }
  }

  return results
}

/** Resolve a relative import path to an absolute file path (best-effort) */
function resolveImport(importPath: string, fromFile: string): string | null {
  // Only check relative imports (within src2/)
  if (!importPath.startsWith('.')) return null

  const dir = dirname(fromFile)
  const resolved = resolve(dir, importPath)

  // Check if it resolves to something inside src2/
  if (!resolved.startsWith(SRC2_ROOT)) return null

  return resolved
}

// ---------------------------------------------------------------------------
// Main validation
// ---------------------------------------------------------------------------

interface Violation {
  file: string
  line: number
  importPath: string
  fromLayer: LayerName
  toLayer: LayerName
  message: string
}

function validate(): Violation[] {
  const violations: Violation[] = []

  const files = collectFiles(SRC2_ROOT, ['.ts', '.tsx']).filter(
    (f) => !f.includes('__architecture__/'),
  )

  for (const file of files) {
    const fromLayer = getLayer(file)
    if (!fromLayer) continue

    const source = readFileSync(file, 'utf-8')
    const imports = extractImports(source)

    for (const imp of imports) {
      const resolved = resolveImport(imp.path, file)
      if (!resolved) continue // External or non-src2 import — skip

      const toLayer = getLayer(resolved)
      if (!toLayer) continue // Can't determine target layer — skip

      const rule = LAYER_RULES[fromLayer]
      if (!rule.allowedDeps.includes(toLayer) && fromLayer !== toLayer) {
        const relFile = relative(SRC2_ROOT, file)
        violations.push({
          file: relFile,
          line: imp.line,
          importPath: imp.path,
          fromLayer,
          toLayer,
          message: `${rule.name} must not import from ${LAYER_RULES[toLayer].name}`,
        })
      }
    }
  }

  return violations
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const violations = validate()

if (violations.length === 0) {
  console.log('Architecture validation passed. No layer violations found.')
  process.exit(0)
} else {
  console.error(`Architecture validation FAILED. ${violations.length} violation(s) found:\n`)
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`)
    console.error(`    Import: ${v.importPath}`)
    console.error(`    Rule:   ${v.message}`)
    console.error()
  }
  process.exit(1)
}
