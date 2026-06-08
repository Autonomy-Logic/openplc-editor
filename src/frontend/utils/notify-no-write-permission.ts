import { toast } from './toast'

/**
 * Non-blocking warning shown when the user triggers an operation that would
 * write to the backend on a project they lack write permission on (e.g. a
 * public project they don't own).  The action is skipped gracefully instead
 * of letting the backend reject it with an opaque 401/403 error toast.
 *
 * Only persistence is denied — the user keeps editing, simulating, and
 * compiling their local working copy; the changes just can't be pushed back.
 *
 * @param action  Verb phrase naming the blocked operation, slotted into
 *                "You don't have permission to {action} this project."
 *                e.g. `'save changes to'`, `'commit to'`, `'create branches in'`.
 */
export function notifyNoWritePermission(action: string): void {
  toast({
    title: 'No write permission',
    description: `You don't have permission to ${action} this project.`,
    variant: 'warn',
  })
}
