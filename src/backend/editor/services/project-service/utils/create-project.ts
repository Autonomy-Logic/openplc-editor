import { buildProjectFileContent } from '@root/backend/shared/project/create-project-files'
import { getExtensionFromLanguage } from '@root/frontend/utils/PLC/pou-file-extensions'
import { serializePouToText } from '@root/frontend/utils/PLC/pou-text-serializer'
import {
  CreateProjectDefaultDirectoriesResponse,
  CreateProjectFileProps,
  projectDefaultDirectories,
} from '@root/types/IPC/project-service'
import { writeFileSync } from 'fs'

import { createDirectory, fileOrDirectoryExists, ipcPouToFlat } from '../../../utils'
import { CreateJSONFile } from '../../../utils'

/**
 * Electron-side orchestration for project creation.
 *
 * The "what content do we write?" half lives in
 * `backend/shared/project/create-project-files` so the web editor's
 * backend service can reuse it.  This module is now the thin
 * `mkdir` / `writeFile` glue around that content.
 */
const createProjectDefaultStructure = (
  basePath: string,
  dataToCreateProjectFile: CreateProjectFileProps,
): CreateProjectDefaultDirectoriesResponse => {
  // 1. Author all file content (shared, no fs).
  const built = buildProjectFileContent(dataToCreateProjectFile)
  const isLibrary = dataToCreateProjectFile.type === 'plc-library'

  // 2. Create directories.  Use the canonical list from
  //    `projectDefaultDirectories` so a future "deletedPous" or
  //    similar directory addition picks up automatically.  For
  //    library projects we still create the device dirs (they stay
  //    empty) — keeping the directory shape uniform across project
  //    types means save-flow consumers don't need their own
  //    library-only branch just to find the directory tree.
  for (const directory of projectDefaultDirectories) {
    const dirPath = `${basePath}/${directory}`
    try {
      if (!fileOrDirectoryExists(dirPath)) createDirectory(dirPath)
    } catch (error) {
      return {
        success: false,
        error: {
          title: 'Error creating project directories',
          description: `Failed to create directory at ${dirPath}`,
          error,
        },
      }
    }
  }

  // 3. Write project.json from the shared-built object.
  try {
    CreateJSONFile(basePath, JSON.stringify(built.project, null, 2), 'project')
  } catch (error) {
    return {
      success: false,
      error: {
        title: 'Error creating project file',
        description: `Failed to create project file at ${basePath}`,
        error,
      },
    }
  }

  // 4. Device-level files.  Identical content for both project
  //    types — libraries get the same empty-but-valid skeletons so
  //    the save pipeline can read them later without branching.
  try {
    CreateJSONFile(`${basePath}/devices`, JSON.stringify(built.deviceConfiguration, null, 2), 'configuration')
  } catch (error) {
    return {
      success: false,
      error: {
        title: 'Error creating device configuration file',
        description: `Failed to create device configuration file at ${basePath}/devices`,
        error,
      },
    }
  }

  try {
    CreateJSONFile(`${basePath}/devices`, JSON.stringify(built.devicePinMapping, null, 2), 'pin-mapping')
  } catch (error) {
    return {
      success: false,
      error: {
        title: 'Error creating device pin mapping file',
        description: `Failed to create device pin mapping file at ${basePath}/devices`,
        error,
      },
    }
  }

  // 5. Library-only: emit the `library.json` manifest template.  No
  //    POUs are created for libraries — the manifest is the single
  //    "open this by default" entry.
  if (isLibrary && built.libraryManifest !== undefined) {
    try {
      writeFileSync(`${basePath}/library.json`, built.libraryManifest, 'utf-8')
    } catch (error) {
      return {
        success: false,
        error: {
          title: 'Error creating library manifest',
          description: `Failed to create library.json at ${basePath}`,
          error,
        },
      }
    }
  }

  // 6. PLC-project-only: write the default `main` POU.  Libraries
  //    skip this entirely — the user creates their own functions /
  //    function-blocks / data types after the project opens.
  if (!isLibrary && built.pous.length > 0) {
    const pou = built.pous[0]
    const pouPath = `${basePath}/pous/${pou.type}s`
    try {
      if (!fileOrDirectoryExists(pouPath)) createDirectory(pouPath)
      const flat = ipcPouToFlat(pou)
      const extension: string = getExtensionFromLanguage(flat.body.language)
      const textContent: string = serializePouToText(flat)
      writeFileSync(`${pouPath}/${flat.name}${extension}`, textContent, 'utf-8')
    } catch (error) {
      return {
        success: false,
        error: {
          title: 'Error creating POU file',
          description: `Failed to create POU file at ${pouPath}`,
          error,
        },
      }
    }
  }

  return {
    success: true,
    data: {
      meta: { path: basePath },
      content: {
        project: built.project,
        pous: built.pous,
        deviceConfiguration: built.deviceConfiguration,
        devicePinMapping: built.devicePinMapping,
        ...(built.libraryManifest !== undefined ? { libraryManifest: built.libraryManifest } : {}),
      },
    },
  }
}

export { createProjectDefaultStructure }
