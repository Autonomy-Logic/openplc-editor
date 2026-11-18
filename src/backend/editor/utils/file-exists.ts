import { access } from 'node:fs/promises'

/** Whether something exists at `path`; resolves `false` instead of rejecting. */
export function fileExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  )
}
