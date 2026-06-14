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

/**
 * Resolve a `visible` clause to a boolean.
 *
 * - Missing clause → always visible (`true`).
 * - Composite (`and`/`or`) → recurse and combine.
 * - Leaf → compare the referenced field's current value.
 *
 * Unknown operators fall through to `true` so a malformed vendor
 * package shows the field rather than silently hiding it.
 */
export function evalVisible(visible: VisibleCondition | undefined, values: Record<string, FieldValue>): boolean {
  if (!visible) return true

  if ('conditions' in visible) {
    const results = visible.conditions.map((c) => evalVisible(c, values))
    return visible.operator === 'and' ? results.every(Boolean) : results.some(Boolean)
  }

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
      return true
  }
}
