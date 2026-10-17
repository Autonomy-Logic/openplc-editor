import type { VariableListError, VariableListSnapshot } from '../contracts/application'
import type { VariableListStatusModel } from '../contracts/presentation'

/** Turns a contract error into user-facing text. Wording lives here, never in the domain or the view. */
export function describeError(error: VariableListError): string {
  switch (error.kind) {
    case 'invalid-name':
      return error.reason === 'empty' ? 'Enter a name.' : `"${error.name}" is not a valid IEC 61131-3 identifier.`
    case 'duplicate-name':
      return `A variable named "${error.name}" already exists.`
    case 'unknown-variable':
      return 'That variable no longer exists.'
    case 'busy':
      return 'Wait for the current operation to finish.'
    case 'disposed':
      return 'This list is closed.'
    case 'load-failed':
      return 'The saved variables could not be read.'
    case 'save-failed':
      return 'Saving failed. Your changes are still pending.'
    default: {
      // Compile-time exhaustiveness: a new error kind fails to build until it gets a message.
      const unreachable: never = error
      return unreachable
    }
  }
}

/** Picks the single status line shown in the header. Order matters: running work, then failures, then notices. */
export function describeStatus(snapshot: VariableListSnapshot, notice: string | null): VariableListStatusModel {
  if (snapshot.activity === 'loading') return { tone: 'busy', text: 'Loading variables…' }
  if (snapshot.activity === 'saving') return { tone: 'busy', text: 'Saving…' }
  if (snapshot.lastFailure) return { tone: 'error', text: describeError({ kind: snapshot.lastFailure }) }
  if (notice) return { tone: 'warning', text: notice }
  if (snapshot.dirty) return { tone: 'warning', text: 'Unsaved changes' }
  return { tone: 'neutral', text: 'All changes saved' }
}
