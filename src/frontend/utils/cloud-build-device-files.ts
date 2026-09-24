import type { CompileDeviceFiles } from '../../middleware/shared/ports'
import { isRemoteProjectPath } from '../../middleware/shared/ports/types'

/** Minimal device-definitions shape, so this util does not import the store. */
export interface DeviceDefinitionsLike {
  configuration: unknown
  pinMapping: { pinsByBoard: unknown }
}

/**
 * The device files an Autonomy Edge build needs, or `undefined` for a local project.
 *
 * A local project builds from the files saved beside it, so it sends nothing and its build is unchanged.
 */
export const cloudBuildDeviceFiles = (
  projectPath: string,
  deviceDefinitions: DeviceDefinitionsLike,
): CompileDeviceFiles | undefined => {
  if (!isRemoteProjectPath(projectPath)) return undefined
  // Same serialization as save-actions, so the build reads what a save would have written.
  return {
    configuration: JSON.stringify(deviceDefinitions.configuration, null, 2),
    pinMapping: JSON.stringify(deviceDefinitions.pinMapping.pinsByBoard, null, 2),
  }
}
