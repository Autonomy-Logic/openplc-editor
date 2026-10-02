/**
 * A `ProjectPort` that works in the CLI's process.
 *
 * The editor's own adapter reaches the filesystem through `window.bridge`
 * (`project-adapter.ts`), which is renderer-only — there is no window here. But
 * `executeSaveProject` calls exactly ONE member, `saveProject(files)`, so the
 * shim implements that for real against the same `ProjectService` the main
 * process uses, and refuses the rest.
 *
 * Refusals are structured, never thrown. A dialog has no meaning without a user
 * in front of it, and a CLI that crashed on one would turn "this command cannot
 * pick a file for you" into a stack trace. Modelled on `headless-bridge.ts`'s
 * `noRuntime()`.
 */

import { readFile } from 'node:fs/promises'

import { ProjectService } from '@root/backend/editor/services'
import type { ProjectPort } from '@root/middleware/shared/ports/project-port'
import type { WriteProjectFiles } from '@root/middleware/shared/ports/project-port'

/** One refusal shape, so every unsupported member reads the same. */
function notInCli(what: string): { success: false; error: string } {
  return { success: false, error: `${what} needs the editor's UI and is not available from the CLI.` }
}

export function createCliProjectPort(): ProjectPort {
  const service = new ProjectService()

  const port = {
    // The one member `executeSaveProject` actually calls.
    saveProject: (files: WriteProjectFiles) => service.writeProjectFiles(files),

    saveFile: async (filePath: string, content: unknown) => {
      // `saveProject` covers the whole project; a single-file write is only
      // reached by the surgical save paths, which the CLI does not use.
      void filePath
      void content
      return notInCli('Saving one file')
    },

    readFileContent: async (filePath: string) => {
      // `ProjectService` has no single-file read; the surgical save paths that
      // use this read plain text off disk, which is all this needs to be.
      try {
        return { success: true, content: await readFile(filePath, 'utf-8') }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
    readProjectFiles: (projectPath: string) => service.readRawProjectFiles(projectPath),

    createProject: async () => notInCli('Creating a project through the project port'),
    openProject: async () => notInCli('Opening a project through a dialog'),
    openProjectByPath: async () => notInCli('Opening a project through the project port'),
    createPou: async () => notInCli('Creating a POU file through the project port'),
    deletePou: async () => notInCli('Deleting a POU file through the project port'),
    renamePou: async () => notInCli('Renaming a POU file through the project port'),
    renameProject: async () => notInCli('Renaming a project'),
    pickPath: async () => notInCli('Choosing a path'),
    getRecentProjects: async () => [],
    removeRecentProject: async () => notInCli('Editing the recent-projects list'),
    deleteProject: async () => notInCli('Deleting a project'),
    pickPlcopenImportFile: async () => notInCli('Choosing a file to import'),
    exportPlcopenFile: async () => notInCli('Exporting through a save dialog'),
    exportPdfFile: async () => notInCli('Exporting a PDF'),
    renderPdf: async () => {
      // Typed as returning bytes rather than a result object, so there is no
      // refusal shape to return — an empty document is the honest answer.
      return new Uint8Array()
    },
    preparePdfPreviewWorker: async () => undefined,
  } as unknown as ProjectPort

  return port
}
