/**
 * What the save-changes dialog is asked to do, and what it is handed.
 *
 * Its own module because the store keeps every modal's `data` as one `unknown`
 * slot: the shape has to be stated somewhere, and checked somewhere, and
 * neither belongs in a component file — a file that exports functions as well
 * as components loses fast refresh.
 */

/**
 * Validation contexts for save-before-close flows.
 *
 * - 'close-project': Close the current project (both platforms)
 * - 'create-project': Close current, then open create-project dialog (editor)
 * - 'open-project': Close current, then open file picker (editor)
 * - 'open-recent-project': Close current, then open a recent project (editor)
 * - 'open-project-by-path': Close current, then open project at path (editor)
 * - 'close-app': Save before quitting the application (editor)
 * - 'retrieve-project': Close current, then open the project fetched from a
 *   device (both platforms)
 */
const VALIDATION_CONTEXTS = [
  'create-project',
  'open-project',
  'open-recent-project',
  'open-project-by-path',
  'close-project',
  'close-app',
  'retrieve-project',
] as const

/** Derived from the list above so the runtime guard below cannot drift from the
 *  type: adding a context in one place adds it in both. */
export type ValidationContext = (typeof VALIDATION_CONTEXTS)[number]

/** Why a deferred action is not going to happen. */
export type SaveChangesAbortReason = 'save-failed' | 'cancelled'

/**
 * What `openModal('save-changes-project', …)` carries.
 *
 * The store keeps modal `data` as `unknown` — it is one slot shared by every
 * modal — so this is where that shape is stated, and `asSaveChangesModalData`
 * below is where it is checked. Asserting it instead would declare callbacks
 * that may not be there and a reason union that may be wider than the caller's.
 */
export type SaveChangesModalData = {
  validationContext: ValidationContext
  onAfterAction?: () => void
  onActionAborted?: (reason: SaveChangesAbortReason) => void
}

function isValidationContext(value: unknown): value is ValidationContext {
  return typeof value === 'string' && VALIDATION_CONTEXTS.some((context) => context === value)
}

/**
 * Narrow the store's modal payload, or `undefined` when it is not one.
 *
 * `undefined` rather than a throw: a payload this does not recognise means the
 * dialog falls back to 'close-project', which is what it did before any context
 * existed and is the safest of them — it closes without pretending to know what
 * the caller wanted next.
 */
export function asSaveChangesModalData(value: unknown): SaveChangesModalData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const { validationContext, onAfterAction, onActionAborted }: Record<string, unknown> = { ...value }

  if (!isValidationContext(validationContext)) return undefined
  if (onAfterAction !== undefined && typeof onAfterAction !== 'function') return undefined
  if (onActionAborted !== undefined && typeof onActionAborted !== 'function') return undefined

  return {
    validationContext,
    // Checked as callable above. The signature itself is the caller's contract
    // and there is nothing at runtime to compare it against, so this is the one
    // thing here taken on trust -- narrowed from `Function`, not from `unknown`.
    onAfterAction: onAfterAction as (() => void) | undefined,
    onActionAborted: onActionAborted as ((reason: SaveChangesAbortReason) => void) | undefined,
  }
}
