/**
 * VPP screen conditional-visibility evaluation — the single source of
 * truth for resolving a field/section `visible` clause against the
 * current form values.
 *
 * Shared by the declarative layouts (`form`, `module-slots`) so the
 * semantics stay identical no matter where a `visible` clause appears.
 *
 * Screen-author convention: conditions reference other fields with a
 * `fields.` prefix (e.g. `"fields.enabled"`), as documented in the VPP
 * `screen-definition-schema`. The stored value map, however, is keyed
 * by the bare field id (`enabled`), so we strip the prefix before
 * lookup. Bare references (no prefix) are honored too.
 */

export type FieldValue = string | number | boolean

/**
 * A `visible` clause: either a single leaf comparison, or a composite
 * `and`/`or` over nested clauses.
 */
export type VisibleCondition =
  | { condition: string; operator: string; value?: unknown }
  | { operator: 'and' | 'or'; conditions: VisibleCondition[] }

const FIELDS_PREFIX = 'fields.'

/** Nesting depth a `visible` clause may reach before it is treated as hostile. */
export const MAX_VISIBLE_DEPTH = 16

/** Every operator the evaluator understands. Anything else hides the field. */
const LEAF_OPERATORS = new Set(['equals', 'not-equals', 'in', 'exists', 'not-exists', 'greater-than', 'less-than'])

/**
 * Resolve a `visible` clause to a boolean.
 *
 * - Missing clause → always visible (`true`).
 * - Composite (`and`/`or`) → recurse and combine.
 * - Leaf → compare the referenced field's current value.
 *
 * Unknown operators HIDE the field. A vendor package is untrusted input: a
 * clause the editor cannot evaluate is a clause whose intent is unknown, and
 * showing a field the package meant to hide can put a value into the generated
 * plugin config that the device was never meant to receive. Nesting is capped
 * for the same reason — a deeply self-referential clause would otherwise blow
 * the stack while a screen renders.
 */
export function evalVisible(
  visible: VisibleCondition | undefined,
  values: Record<string, FieldValue>,
  depth = 0,
): boolean {
  if (!visible) return true
  if (depth > MAX_VISIBLE_DEPTH) return false

  if ('conditions' in visible) {
    if (visible.operator !== 'and' && visible.operator !== 'or') return false
    if (!Array.isArray(visible.conditions)) return false
    const results = visible.conditions.map((c) => evalVisible(c, values, depth + 1))
    return visible.operator === 'and' ? results.every(Boolean) : results.some(Boolean)
  }

  if (typeof visible.condition !== 'string' || !LEAF_OPERATORS.has(visible.operator)) return false

  const key = visible.condition.startsWith(FIELDS_PREFIX)
    ? visible.condition.slice(FIELDS_PREFIX.length)
    : visible.condition
  const v = values[key]

  switch (visible.operator) {
    case 'equals':
      return v === visible.value
    case 'not-equals':
      return v !== visible.value
    case 'in':
      return Array.isArray(visible.value) && (visible.value as unknown[]).includes(v)
    case 'exists':
      return v !== undefined && v !== null && v !== ''
    case 'not-exists':
      return v === undefined || v === null || v === ''
    case 'greater-than':
      return typeof v === 'number' && typeof visible.value === 'number' && v > visible.value
    case 'less-than':
      return typeof v === 'number' && typeof visible.value === 'number' && v < visible.value
    default:
      return false
  }
}
