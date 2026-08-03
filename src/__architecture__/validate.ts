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
import { fileURLToPath } from 'node:url'

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

const SRC_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

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

/**
 * Every `import ... from '...'` / `export ... from '...'` / bare `import '...'`,
 * with the line it starts on.
 *
 * Scans the whole source rather than line by line: a MULTI-LINE import — the
 * default once a statement names more than a couple of symbols — puts the
 * `import` keyword and the module path on different lines, so a per-line regex
 * silently sees neither. That blind spot hid real violations of these very rules,
 * which is worse than having no gate, because the gate reported success.
 */
function extractImports(source: string): { path: string; line: number }[] {
  const results: { path: string; line: number }[] = []
  const pattern = /(?:^|\n)\s*(?:import|export)\b[\s\S]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const path = match[1] ?? match[2]
    if (!path) continue
    results.push({ path, line: source.slice(0, match.index).split('\n').length })
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
  // Device CONNECT flow (D72) — resolves RTU params from the board debug spec
  // via the shared `resolveDebugConnection` resolver, same as the activity bar's
  // debugger/post-flash paths.
  'frontend/hooks/use-device-connect.ts': ['backend-shared'],
  // Baremetal run/stop mirror — maps the PROTOCOL's run/stop and switch wire
  // values (`PlcRuntimeState` / `PlcSwitchPosition`, defined next to the RTU
  // client that reads them) onto the store's `PlcStatus` union. Same D72 device
  // link as the sibling entry above. The alternative is either duplicating the
  // numeric constants in the frontend or hoisting the two enums into
  // ports/types.ts; both were judged worse than one documented import.
  'frontend/hooks/use-device-plc-state.ts': ['backend-shared'],
  // Run/stop control port — `PlcControlResult` is the FC 0x4b acknowledgement
  // shape, defined with the protocol types it is built from (`PlcRuntimeState`).
  // Type-only import; hoisting it into ports/types.ts would drag the wire enums
  // along with it, so the contract stays where the protocol is described.
  'middleware/shared/ports/debugger-port.ts': ['backend-shared'],
  // Device connect/debug resolution — interprets the board's declarative `debug`
  // spec (backend/shared/hardware/debug-spec.ts), which is the ONE place that spec
  // is read. The alternative is a second interpreter in the frontend, which is how
  // Connect and the debugger came to disagree about what a spec meant.
  'frontend/services/device-link-resolution.ts': ['backend-shared'],
  // Activity bar — resolves the same spec for the post-upload reconnect and the
  // debug session. Pre-existing; it was invisible until `extractImports` learned
  // to read multi-line imports.
  'frontend/components/_organisms/workspace-activity-bar/default.tsx': ['backend-shared'],
  // PLCopen export — needs the shared XmlGenerator composing function
  // (backend/shared/utils/PLC/xml-generator.ts) to turn the converted
  // project data into XML before handing it to the platform port. No
  // frontend-reachable layer re-exports this function today; the
  // conversion logic itself stays local (mirrors compiler-adapter.ts's
  // portToSchemaProjectData) and has no other backend-shared dependency.
  'frontend/services/export-actions.ts': ['backend-shared'],
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
