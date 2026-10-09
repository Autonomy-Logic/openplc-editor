// Single source of truth for the example's dependency rules. `check-boundaries.ts` only enforces them.

/** A top-level folder of the example; a file's layer is the first matching path prefix. */
export type Layer =
  | 'contracts/application'
  | 'contracts/presentation'
  | 'domain'
  | 'application'
  | 'state'
  | 'presentation'
  | 'react-bindings'
  | 'frontend'
  | 'design-system'
  | 'infrastructure'
  | 'composition'
  | 'fixtures'
  | '__architecture__'

/** A public entry another layer may import: the layer root, or the output ports of `application`. */
export type Entry = Exclude<Layer, '__architecture__'> | 'application/ports'

// Order matters: `contracts/application` must be tried before `application`.
export const LAYERS: readonly Layer[] = [
  'contracts/application',
  'contracts/presentation',
  'domain',
  'application',
  'state',
  'presentation',
  'react-bindings',
  'frontend',
  'design-system',
  'infrastructure',
  'composition',
  'fixtures',
  '__architecture__',
]

export const PUBLIC_ENTRIES: readonly Entry[] = [
  'contracts/application',
  'contracts/presentation',
  'domain',
  'application',
  'application/ports',
  'state',
  'presentation',
  'react-bindings',
  'frontend',
  'design-system',
  'infrastructure',
  'composition',
  'fixtures',
]

/** Which public entries each layer may import. Imports inside a layer are always allowed. */
export const ALLOWED_ENTRIES: Readonly<Record<Layer, readonly Entry[]>> = {
  'contracts/application': [],
  'contracts/presentation': [],
  domain: [],
  application: ['domain', 'contracts/application'],
  state: ['domain', 'application/ports'],
  presentation: ['contracts/application', 'contracts/presentation'],
  'react-bindings': ['contracts/presentation', 'frontend'],
  frontend: ['contracts/presentation', 'design-system'],
  'design-system': [],
  infrastructure: ['domain', 'application/ports'],
  composition: PUBLIC_ENTRIES,
  fixtures: ['contracts/presentation'],
  __architecture__: [],
}

/** External packages each layer may import, matched by exact specifier. Anything else is a violation. */
export const ALLOWED_PACKAGES: Readonly<Record<Layer, readonly string[]>> = {
  'contracts/application': [],
  'contracts/presentation': [],
  domain: [],
  application: [],
  state: ['zustand/vanilla'],
  presentation: [],
  'react-bindings': ['react'],
  frontend: ['react'],
  'design-system': ['react'],
  infrastructure: [],
  composition: ['react', 'react-dom/client'],
  fixtures: [],
  __architecture__: ['typescript', 'node:fs', 'node:path'],
}

/** Test files may also use the test renderer and fixtures, in addition to their layer's own rules. */
export const TEST_ENTRIES: readonly Entry[] = ['fixtures']
export const TEST_PACKAGES: readonly string[] = ['@testing-library/react']

/** Layers allowed to import stylesheets. Keeps appearance out of views and logic. */
export const STYLE_LAYERS: readonly Layer[] = ['design-system']
