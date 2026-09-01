/**
 * What building a project snapshot needs from the layers above the adapters.
 *
 * The snapshot is assembled in the adapter layer, on the upload path, but the
 * two things it needs -- the project's files and the editor version to stamp on
 * them -- live in `frontend/services` and `frontend/data`, which adapters are
 * not allowed to import. Reaching for them directly is a layer violation in the
 * literal sense and in the useful one: it makes the adapter depend on how the
 * project bytes happen to be produced, when the shared archive builder already
 * takes a plain map precisely so it does not have to care.
 *
 * So the app registers a provider once at startup, from a layer that may import
 * both, and the adapter asks for it through here.
 *
 * Deliberately not a React context: this is read from a plain async function on
 * the upload path, nowhere near a component tree.
 */

/** The project, as the snapshot builder wants it. */
export interface ProjectSnapshotInputs {
  /** Relative path to file contents, the shape `buildProjectSnapshot` takes. */
  files: Map<string, string>
  /** The editor version recorded in the snapshot metadata. */
  appVersion: string
}

export type ProjectSnapshotInputsProvider = () => ProjectSnapshotInputs

let provider: ProjectSnapshotInputsProvider | null = null

/**
 * Register how to gather the inputs. Called once during app startup.
 *
 * Replacing an existing provider is allowed and is what tests do; the last
 * registration wins.
 */
export function setProjectSnapshotInputsProvider(next: ProjectSnapshotInputsProvider | null): void {
  provider = next
}

/**
 * The inputs, or null when nothing has registered a provider.
 *
 * Null rather than a throw: the snapshot is the optional half of an upload, and
 * a missing provider must degrade to "no project stored on the device" rather
 * than fail the upload of a program that is otherwise fine.
 */
export function getProjectSnapshotInputs(): ProjectSnapshotInputs | null {
  return provider ? provider() : null
}
