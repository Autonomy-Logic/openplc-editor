/**
 * Architecture validation script.
 *
 * Scans all .ts/.tsx files in src/, extracts imports, and validates
 * that dependency rules between architectural layers are respected.
 *
 * Run: npx tsx src/__architecture__/validate.ts
 * Exit code 0 = pass, 1 = violations found
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

// ---------------------------------------------------------------------------
// Layer definitions
// ---------------------------------------------------------------------------

type LayerName =
  | 'assets'
  | 'utils'
  | 'data'
  | 'types'
  | 'ports'
  | 'provider'
  | 'adapters'
  | 'adapter-components'
  | 'backend-shared'
  | 'backend-web'
  | 'store'
  | 'services'
  | 'hooks'
  | 'components'
  | 'architecture'

interface LayerRule {
  /** Human-readable layer name */
  name: string
  /** Layers this layer is allowed to import from (within src/) */
  allowedDeps: LayerName[]
}

const LAYER_RULES: Record<LayerName, LayerRule> = {
  assets: {
    name: 'Assets (frontend/assets/, frontend/locales/, assets/)',
    allowedDeps: ['utils', 'data'],
  },
  utils: {
    name: 'Domain (frontend/utils/)',
    allowedDeps: ['utils', 'ports', 'data', 'assets'],
  },
  data: {
    name: 'Data (frontend/data/)',
    allowedDeps: ['ports', 'utils', 'data', 'assets'],
  },
  types: {
    name: 'Types (types/)',
    allowedDeps: ['store', 'utils'],
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
    name: 'Adapter Services (middleware/adapters/**/services/, middleware/adapters/*.ts)',
    allowedDeps: ['ports', 'provider', 'utils', 'backend-shared', 'backend-web', 'store', 'assets'],
  },
  'adapter-components': {
    name: 'Adapter Components (middleware/adapters/**/components/)',
    allowedDeps: [
      'ports',
      'provider',
      'store',
      'hooks',
      'services',
      'components',
      'data',
      'utils',
      'assets',
      'adapters',
      'adapter-components',
    ],
  },
  'backend-shared': {
    name: 'Backend Shared (backend/shared/)',
    allowedDeps: ['ports', 'utils', 'types'],
  },
  'backend-web': {
    name: 'Backend Web (backend/web/)',
    allowedDeps: ['ports', 'utils', 'types', 'backend-shared'],
  },
  store: {
    name: 'Store (frontend/store/)',
    allowedDeps: ['ports', 'provider', 'store', 'utils', 'assets'],
  },
  services: {
    name: 'Services (frontend/services/)',
    allowedDeps: ['ports', 'provider', 'store', 'services', 'utils', 'assets'],
  },
  hooks: {
    name: 'Hooks (frontend/hooks/)',
    allowedDeps: ['ports', 'provider', 'store', 'hooks', 'services', 'utils', 'assets'],
  },
  components: {
    name: 'Components (frontend/components/)',
    allowedDeps: ['ports', 'provider', 'store', 'hooks', 'services', 'components', 'data', 'utils', 'assets'],
  },
  architecture: {
    name: 'Architecture (__architecture__/)',
    allowedDeps: [],
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SRC_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..')

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
  const rel = relative(SRC_ROOT, filePath).replace(/\\/g, '/')

  if (rel.startsWith('__architecture__/')) return 'architecture'

  // Static resources (icons, locales, board definitions, firmware metadata)
  if (rel.startsWith('frontend/assets/')) return 'assets'
  if (rel.startsWith('frontend/locales/')) return 'assets'
  if (rel.startsWith('assets/')) return 'assets'

  // Middleware layers
  if (rel.startsWith('middleware/shared/ports/')) return 'ports'
  if (rel.startsWith('middleware/shared/providers/')) return 'provider'
  // Pure utilities that need to be reachable from any layer (store,
  // services, hooks, components, adapters, backend) live here.
  // Architecturally treated as part of the `utils` layer — same rule
  // set, but the physical path is under middleware/shared/ to make
  // openplc-web parity explicit (this folder is byte-identical
  // between repos).
  if (rel.startsWith('middleware/shared/utils/')) return 'utils'
  // Shared runtime-auth (RuntimeTokenManager) is pure, dependency-free logic
  // reachable from adapters/backend/main on both platforms — same `utils` rule
  // set, byte-identical between repos.
  if (rel.startsWith('middleware/shared/runtime-auth/')) return 'utils'
  if (rel.match(/^middleware\/adapters\/[^/]+\/components\//)) return 'adapter-components'
  if (rel.startsWith('middleware/adapters/')) return 'adapters'

  // Backend layers
  if (rel.startsWith('backend/shared/')) return 'backend-shared'
  if (rel.startsWith('backend/web/')) return 'backend-web'

  // Frontend layers
  if (rel.startsWith('frontend/store/')) return 'store'
  if (rel.startsWith('frontend/services/')) return 'services'
  if (rel.startsWith('frontend/hooks/')) return 'hooks'
  if (rel.startsWith('frontend/components/')) return 'components'
  if (rel.startsWith('frontend/data/')) return 'data'
  if (rel.startsWith('frontend/utils/')) return 'utils'

  // Shared type definitions (Zod schemas, PLC type contracts)
  if (rel.startsWith('types/')) return 'types'

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

/**
 * Try to locate the actual file for a resolved path, mimicking TypeScript
 * module resolution: try the path itself, then with .ts/.tsx extensions,
 * then as a directory with index.ts/.tsx.
 */
function tryResolveFile(base: string): string | null {
  const extensions = ['.ts', '.tsx']

  // Exact file exists (e.g., .json, .svg imports)
  const baseStat = statSync(base, { throwIfNoEntry: false })
  if (baseStat?.isFile()) return base

  // Try appending extensions: ./foo → ./foo.ts, ./foo.tsx
  for (const ext of extensions) {
    const withExt = base + ext
    const stat = statSync(withExt, { throwIfNoEntry: false })
    if (stat?.isFile()) return withExt
  }

  // Try as directory with index: ./foo → ./foo/index.ts
  if (baseStat?.isDirectory()) {
    for (const ext of extensions) {
      const indexFile = join(base, `index${ext}`)
      const stat = statSync(indexFile, { throwIfNoEntry: false })
      if (stat?.isFile()) return indexFile
    }
  }

  // Could not resolve to an actual file — return the original path so the
  // caller can still determine the target layer (or flag it as unmapped).
  return base
}

function resolveImport(importPath: string, fromFile: string): string | null {
  // Only check relative imports (within src/)
  if (!importPath.startsWith('.')) return null

  const dir = dirname(fromFile)
  const resolved = resolve(dir, importPath)

  // Check if it resolves to something inside src/
  if (!resolved.startsWith(SRC_ROOT)) return null

  return tryResolveFile(resolved)
}

// ---------------------------------------------------------------------------
// Known exceptions
// ---------------------------------------------------------------------------

/**
 * Some files legitimately cross layer boundaries due to the nature of their
 * functionality (e.g., sync utilities that bridge store types with component
 * types, or store helpers that reference component node builders).
 *
 * Each entry maps a file path (relative to SRC_ROOT, forward-slash separated)
 * to the set of extra layers it is allowed to import from beyond what its own
 * layer rule permits.
 */
const KNOWN_EXCEPTIONS: Record<string, LayerName[]> = {
  // FBD paste/duplicate helpers — needs molecule-level buildGenericNode from components
  'frontend/store/slices/fbd/utils/index.ts': ['components'],
  // Ladder paste/duplicate helpers — needs nodesBuilder from component atoms
  'frontend/store/slices/ladder/utils/index.ts': ['components'],
  // Ladder slice — needs nodesBuilder + defaultCustomNodesStyles for rung creation
  'frontend/store/slices/ladder/slice.ts': ['components'],
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

  const files = collectFiles(SRC_ROOT, ['.ts', '.tsx']).filter(
    (f) => !f.includes('__architecture__/') && !f.includes('__tests__/') && !f.match(/\.(test|spec)\.[jt]sx?$/),
  )

  for (const file of files) {
    const fromLayer = getLayer(file)
    if (!fromLayer) continue

    const source = readFileSync(file, 'utf-8')
    const imports = extractImports(source)
    const relFile = relative(SRC_ROOT, file).replace(/\\/g, '/')
    const exceptions = KNOWN_EXCEPTIONS[relFile] ?? []

    for (const imp of imports) {
      const resolved = resolveImport(imp.path, file)
      if (!resolved) continue // External or non-src import — skip

      const toLayer = getLayer(resolved)
      const relTarget = relative(SRC_ROOT, resolved).replace(/\\/g, '/')

      if (!toLayer) {
        violations.push({
          file: relFile,
          line: imp.line,
          importPath: imp.path,
          fromLayer,
          toLayer: null as unknown as LayerName,
          message: `${LAYER_RULES[fromLayer].name} imports from unmapped directory: ${relTarget}`,
        })
        continue
      }

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
  //
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
