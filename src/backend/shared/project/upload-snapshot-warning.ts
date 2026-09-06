/**
 * What the runtime said about the source project an upload carried.
 *
 * The upload endpoint answers with `ProjectSnapshotWarning` when it accepted the
 * program but refused the project beside it -- the archive was too large, the
 * metadata would not parse, the device could not write it. The program runs
 * either way, which is the right call: the project is the optional half and
 * must never fail an upload.
 *
 * But refusing it in silence is the failure this feature can least afford. The
 * upload succeeds, the program runs, nobody is told, and the device is quietly
 * not retrievable -- discovered months later by the person who needed the
 * project back. So the reason is read out and shown wherever the build's other
 * messages appear.
 *
 * Shared because both clients read the same response from the same endpoint and
 * should say the same thing about it.
 */

/**
 * The warning the runtime returned, or null when it had nothing to say.
 *
 * Never throws: this runs on the success path of an upload that has already
 * worked, so a response that does not parse is not worth failing over -- it
 * just means there is no warning to show.
 */
export function readSnapshotUploadWarning(responseBody: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(responseBody)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const warning = (parsed as Record<string, unknown>).ProjectSnapshotWarning
  if (typeof warning !== 'string') return null
  const trimmed = warning.trim()
  return trimmed === '' ? null : trimmed
}

/**
 * The warning, phrased for someone reading a build log.
 *
 * The runtime's own text says what went wrong; this says what it means for
 * them, which is the part they actually need.
 */
export function describeSnapshotUploadWarning(warning: string): string {
  return `${warning}. The program was uploaded and is running, but this device is not storing the source project, so it cannot be retrieved from here later.`
}
