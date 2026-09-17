/**
 * Build the `variant` a placed block carries, from a `type/library/pou` block
 * reference.
 *
 * `node.data.variant` is the only durable record of a block's signature — the
 * transpiler and the PLCopen exporter both read it off the placed node rather
 * than re-resolving the library, so whatever this produces is what the project
 * compiles against forever.
 *
 * Lives in `utils/` because three layers need it: the two graphical editors
 * (`components`), and the CLI, which may not import `components` at all. It was
 * previously ~70 lines duplicated near-verbatim between `ladder/rung/body.tsx`
 * and `fbd/index.tsx`.
 *
 * Pure: state arrives as arguments rather than being read from the store, so
 * the same call works in a renderer, a test and a headless process.
 */

// From `ports`, not the store's re-export: `utils` may not import `store`.
import type { SystemLibrary, UserLibrary } from '../../../middleware/shared/ports/library-types'
import type { PLCPou } from '../../../middleware/shared/ports/types'
import { getVariableRestrictionType } from './validate-variable-type'

/**
 * One pin on a placed block.
 *
 * Structural and permissive on purpose. The two sources disagree: a system
 * library pin carries a narrow class enum, while a user POU's variable may have
 * no class at all, and a synthesised function return can be `derived` — which
 * the strict `blockVariantVariableSchema` union does not admit. Both editors
 * accept this through a generic parameter today; widening here keeps that
 * behaviour rather than forcing a cast at three call sites.
 */
export interface BlockVariantVariable {
  id?: string
  name: string
  class?: string
  type: { definition: string; value: string }
}

/** The curated signature a placed block keeps. Deliberately not the library entry. */
export interface BlockVariantShape {
  name: string
  type: string
  variables: BlockVariantVariable[]
  documentation?: string
  extensible: boolean
}

export type BuildBlockVariantResult =
  | { ok: true; variant: BlockVariantShape }
  | {
      ok: false
      reason: 'unknown-library' | 'unknown-pou' | 'malformed-ref'
      /**
       * Which half of the reference failed. The two editors report a failed
       * `system` lookup with a toast but drop a failed `user` lookup silently,
       * so a caller has to be able to tell them apart.
       */
      libraryType: 'system' | 'user' | 'unknown'
      blockRef: string
    }

export interface BuildBlockVariantInput {
  /** `system/<library>/<pou>` or `user/<pou>` — the form the editors split on. */
  blockRef: string
  systemLibraries: readonly SystemLibrary[]
  userLibraries: readonly UserLibrary[]
  pous: readonly PLCPou[]
}

export function buildBlockVariant(input: BuildBlockVariantInput): BuildBlockVariantResult {
  const segments = input.blockRef.split('/')
  const [blockLibraryType, blockLibrary, pouName] = segments

  // Destructuring ignores anything past the third segment, so `system/lib/TON/x`
  // would resolve as `system/lib/TON`. The two shapes have exact lengths.
  if (blockLibraryType === 'system' && segments.length !== 3) {
    return { ok: false, reason: 'malformed-ref', libraryType: 'system', blockRef: input.blockRef }
  }
  if (blockLibraryType === 'user' && segments.length !== 2) {
    return { ok: false, reason: 'malformed-ref', libraryType: 'user', blockRef: input.blockRef }
  }

  if (blockLibraryType === 'system') {
    if (!blockLibrary || !pouName)
      return { ok: false, reason: 'malformed-ref', libraryType: 'system', blockRef: input.blockRef }
    const libraryPou = input.systemLibraries
      .find((library) => library.name === blockLibrary)
      ?.pous.find((pou) => pou.name === pouName)
    if (!libraryPou) return { ok: false, reason: 'unknown-pou', libraryType: 'system', blockRef: input.blockRef }

    // Copy the signature, not the library entry. That entry also carries `body`
    // (the authored source, which for a native C/C++ or Python block is the
    // entire file) and `language`, and passing the object straight through froze
    // a copy of the library's source into every project that placed the block.
    // Nothing ever reads either field back off a placed variant, and the
    // embedded VAR ... END_VAR broke the POU parser badly enough that the
    // project would not open (DOPE-592).
    return {
      ok: true,
      variant: {
        name: libraryPou.name,
        type: libraryPou.type,
        variables: libraryPou.variables,
        documentation: libraryPou.documentation,
        extensible: libraryPou.extensible ?? false,
      },
    }
  }

  if (blockLibraryType === 'user') {
    if (!blockLibrary) return { ok: false, reason: 'malformed-ref', libraryType: 'user', blockRef: input.blockRef }
    const library = input.userLibraries.find((entry) => entry.name === blockLibrary)
    if (!library) return { ok: false, reason: 'unknown-library', libraryType: 'user', blockRef: input.blockRef }
    const pou = input.pous.find((entry) => entry.name === library.name)
    if (!pou) return { ok: false, reason: 'unknown-pou', libraryType: 'user', blockRef: input.blockRef }

    const variables: BlockVariantVariable[] = (pou.interface?.variables ?? []).map((variable) => ({
      id: variable.id,
      name: variable.name,
      class: variable.class,
      type: { definition: variable.type.definition, value: variable.type.value.toUpperCase() },
    }))

    // A function's return value is a pin on the diagram but not a declared
    // variable, so it is synthesised here. System library POUs already declare
    // their outputs, which is why that branch never does this.
    if (pou.pouType === 'function') {
      const restriction = getVariableRestrictionType(pou.interface?.returnType ?? '')
      variables.push({
        id: 'OUT',
        name: 'OUT',
        class: 'output',
        type: {
          definition: restriction.definition ?? 'derived',
          value: (pou.interface?.returnType ?? '').toUpperCase(),
        },
      })
    }

    return {
      ok: true,
      variant: {
        name: pou.name,
        type: pou.pouType,
        variables,
        documentation: pou.documentation,
        extensible: false,
      },
    }
  }

  return { ok: false, reason: 'malformed-ref', libraryType: 'unknown', blockRef: input.blockRef }
}
