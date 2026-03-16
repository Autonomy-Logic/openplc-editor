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

type LayerName =
  | 'utils'
  | 'data'
  | 'ports'
  | 'provider'
  | 'adapters'
  | 'backend-shared'
  | 'store'
  | 'services'
  | 'hooks'
  | 'components'
  | 'architecture'

interface LayerRule {
  /** Human-readable layer name */
  name: string
  /** Layers this layer is allowed to import from (within src2/) */
  allowedDeps: LayerName[]
}

const LAYER_RULES: Record<LayerName, LayerRule> = {
  utils: {
    name: 'Domain (frontend/utils/)',
    allowedDeps: ['utils'],
  },
  data: {
    name: 'Data (frontend/data/)',
    allowedDeps: ['ports', 'utils', 'data'],
  },
  ports: {
    name: 'Application — Ports (middleware/shared/ports/)',
    allowedDeps: ['utils', 'ports'],
  },
  provider: {
    name: 'Application — Provider (middleware/shared/providers/)',
    allowedDeps: ['ports', 'utils'],
  },
  adapters: {
    name: 'Adapters (middleware/adapters/)',
    allowedDeps: ['ports', 'provider', 'utils'],
  },
  'backend-shared': {
    name: 'Backend Shared (backend/shared/)',
    allowedDeps: ['ports', 'utils'],
  },
  store: {
    name: 'Store (frontend/store/)',
    allowedDeps: ['ports', 'provider', 'store', 'utils', 'backend-shared'],
  },
  services: {
    name: 'Services (frontend/services/)',
    allowedDeps: ['ports', 'provider', 'store', 'services', 'utils', 'backend-shared'],
  },
  hooks: {
    name: 'Hooks (frontend/hooks/)',
    allowedDeps: ['ports', 'provider', 'store', 'hooks', 'services', 'utils', 'backend-shared'],
  },
  components: {
    name: 'Components (frontend/components/)',
    allowedDeps: ['ports', 'provider', 'store', 'hooks', 'services', 'components', 'data', 'utils', 'backend-shared'],
  },
  architecture: {
    name: 'Architecture (__architecture__/)',
    allowedDeps: [],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// @ts-expect-error TS1343 — this script runs via `npx tsx` (ESM), not through webpack
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

  // Middleware layers
  if (rel.startsWith('middleware/shared/ports/')) return 'ports'
  if (rel.startsWith('middleware/shared/providers/')) return 'provider'
  if (rel.startsWith('middleware/adapters/')) return 'adapters'

  // Backend layers
  if (rel.startsWith('backend/shared/')) return 'backend-shared'

  // Frontend layers
  if (rel.startsWith('frontend/store/')) return 'store'
  if (rel.startsWith('frontend/services/')) return 'services'
  if (rel.startsWith('frontend/hooks/')) return 'hooks'
  if (rel.startsWith('frontend/components/')) return 'components'
  if (rel.startsWith('frontend/data/')) return 'data'
  if (rel.startsWith('frontend/utils/')) return 'utils'

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
// Known exceptions
// ---------------------------------------------------------------------------

/**
 * Some files legitimately cross layer boundaries due to the nature of their
 * functionality (e.g., sync utilities that bridge store types with component
 * types, or store helpers that reference component node builders).
 *
 * Each entry maps a file path (relative to SRC2_ROOT, forward-slash separated)
 * to the set of extra layers it is allowed to import from beyond what its own
 * layer rule permits.
 */
const KNOWN_EXCEPTIONS: Record<string, LayerName[]> = {
  // Syncs React Flow nodes with PLC variables — needs store types, port types, and component constants
  'frontend/utils/graphical/sync-nodes-with-variables.ts': ['ports', 'store', 'components'],
  // Determines which FB variables to clean up — needs port types and component block types
  'frontend/utils/graphical/get-function-block-variables-to-cleanup.ts': ['ports', 'components'],
  // FBD paste/duplicate helpers — needs component atom types and molecule node builders
  'frontend/store/slices/fbd/utils/index.ts': ['components'],
  // Debug utilities need port types, store types, and library data for variable resolution
  'frontend/utils/variable-sizes.ts': ['ports'],
  'frontend/utils/pou-helpers.ts': ['ports', 'data', 'store'],
  'frontend/utils/debug-tree-traversal.ts': ['ports', 'data', 'store'],
  'frontend/utils/debug-tree-builder.ts': ['ports', 'store'],
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
    (f) => !f.includes('__architecture__/') && !f.includes('__tests__/') && !f.match(/\.(test|spec)\.[jt]sx?$/),
  )

  for (const file of files) {
    const fromLayer = getLayer(file)
    if (!fromLayer) continue

    const source = readFileSync(file, 'utf-8')
    const imports = extractImports(source)
    const relFile = relative(SRC2_ROOT, file).replace(/\\/g, '/')
    const exceptions = KNOWN_EXCEPTIONS[relFile] ?? []

    for (const imp of imports) {
      const resolved = resolveImport(imp.path, file)
      if (!resolved) continue // External or non-src2 import — skip

      const toLayer = getLayer(resolved)
      if (!toLayer) continue // Can't determine target layer — skip

      const rule: LayerRule = LAYER_RULES[fromLayer]
      if (!rule.allowedDeps.includes(toLayer) && fromLayer !== toLayer && !exceptions.includes(toLayer)) {
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
