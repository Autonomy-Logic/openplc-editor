/**
 * Pure file-content authoring for project creation.
 *
 * Returns the in-memory shape of every file the editor wants to
 * persist when a new project (or library) is created.  No fs writes,
 * no platform coupling — the Electron `create-project` service does
 * the actual `mkdir` / `writeFile` calls around this; the web
 * editor's backend service will do the same with its storage layer.
 *
 * Splitting this out makes the rule explicit: this module owns
 * "what should the on-disk shape of a fresh project / library
 * look like?", and nothing else.  Anywhere that produces new
 * project content (initial creation, future "duplicate", future
 * template-from-existing) should funnel through here.
 *
 * Convention: matches `backend/shared/utils/parse-project-files.ts`
 * — shared returns content strings, editor reads/writes around it.
 */

import type { DeviceConfiguration, DevicePin } from '../types/PLC/devices'
import type { PLCPou, PLCProject } from '../types/PLC/open-plc'
import { getDefaultSchemaValues } from '../utils/default-zod-schema-values'
import { projectDefaultFilesMapSchema } from './project-files-schema'

/** Input shape — same as the IPC contract carries today. */
export interface CreateProjectFileInput {
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd'
  time: string
  type: 'plc-project' | 'plc-library'
  name: string
}

/**
 * The in-memory PLCProject + accompanying content the editor wants
 * to persist.  `pous` carries the editor-flat shape (one PLCPou per
 * file) so callers don't re-derive it.
 */
export interface CreateProjectFileContent {
  project: PLCProject
  pous: PLCPou[]
  deviceConfiguration: DeviceConfiguration
  devicePinMapping: DevicePin[]
  /** Library-projects-only: the strucpp manifest template (`library.json`)
   *  that the editor writes alongside `project.json`.  Pre-filled with
   *  snake_case namespace, version `0.1.0`, empty symbol arrays. */
  libraryManifest?: string
}

/**
 * Convert an arbitrary user-supplied project name to a strucpp-safe
 * snake_case namespace.  Used to auto-fill `library.json`'s
 * `namespace` field when a library project is created.
 *
 *   "My  Cool Lib"   → "my_cool_lib"
 *   "Sensor-Tools"   → "sensor_tools"
 *   "123foo"         → "_123foo"     (strucpp namespace must start
 *                                      with a non-digit)
 *   ""               → "lib"          (defensive)
 */
export function toSnakeCaseNamespace(name: string): string {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  if (cleaned.length === 0) return 'lib'
  if (/^[0-9]/.test(cleaned)) return `_${cleaned}`
  return cleaned
}

/**
 * Build the manifest template a freshly-created library project
 * ships with.  Auto-fills the namespace from the project name and
 * leaves the description blank for the user to fill in.
 *
 * Intentionally NOT in the template: `functions`, `functionBlocks`,
 * `types`, `headers`.  Those fields are populated by strucpp at
 * build time by walking the project's POUs / data types; surfacing
 * them in the user-editable manifest invites manual maintenance of
 * a list that's authoritatively derived from the editor view.  Per-
 * POU help text comes from each POU's `documentation` field on the
 * editor side — the build pipeline copies it onto the manifest
 * entries strucpp emits, so the manifest's symbol arrays stay
 * out-of-band.
 */
export function buildLibraryManifestTemplate(name: string): string {
  return (
    JSON.stringify(
      {
        name,
        displayName: name,
        version: '0.1.0',
        namespace: toSnakeCaseNamespace(name),
        description: '',
      },
      null,
      2,
    ) + '\n'
  )
}

/** PLCPou factory for the default "main" program a PLC project ships
 *  with — empty body for textual languages, empty flow for graphical
 *  ones.  Libraries don't get a default POU. */
function definePou(language: CreateProjectFileInput['language']): PLCPou {
  return {
    type: 'program',
    data: {
      name: 'main',
      language,
      variables: [],
      documentation: '',
      body: (() => {
        switch (language) {
          case 'ld':
            return { language, value: { name: 'main', rungs: [] } }
          case 'fbd':
            return {
              language,
              value: {
                name: 'main',
                rung: { comment: '', edges: [], nodes: [] },
              },
            }
          default:
            return { language, value: '' }
        }
      })(),
    },
  }
}

/**
 * Build the `PLCProject` object that goes into `project.json`.
 *
 *   - PLC project: full configuration with one cyclic task ('task0'),
 *     one instance pointing at the 'main' program, no global vars.
 *   - Library project: degenerate configuration (empty tasks,
 *     instances, globalVariables).  Schema-valid but inert.  The
 *     library doesn't run anything; the configuration block exists
 *     only because the PLCProjectDataSchema still requires it.
 */
function buildProjectObject(input: CreateProjectFileInput): PLCProject {
  const isLibrary = input.type === 'plc-library'
  return {
    meta: {
      name: input.name,
      type: input.type,
    },
    data: {
      pous: [],
      dataTypes: [],
      libraries: [],
      // `libraryManifest` is NOT embedded in `project.json` — it
      // rides on `CreateProjectFileContent` at the top level
      // (see `buildProjectFileContent` below), gets written to
      // `library.json` at the project root by the create
      // orchestrator, and is threaded back to the renderer
      // through the IPC create-response so the manifest tab
      // sees the initial content without a follow-up disk read.
      configuration: {
        resource: {
          tasks: isLibrary
            ? []
            : [
                {
                  name: 'task0',
                  triggering: 'Cyclic',
                  interval: input.time,
                  priority: 1,
                },
              ],
          instances: isLibrary
            ? []
            : [
                {
                  name: 'instance0',
                  program: 'main',
                  task: 'task0',
                },
              ],
          globalVariables: [],
        },
      },
    },
  }
}

/**
 * Build every piece of content a freshly-created project ships with.
 * Caller (`backend/editor/services/project-service/utils/create-project`)
 * writes the result to disk; the web editor's equivalent backend
 * service will write to its own storage.
 */
export function buildProjectFileContent(input: CreateProjectFileInput): CreateProjectFileContent {
  const isLibrary = input.type === 'plc-library'

  const project = buildProjectObject(input)
  const pous: PLCPou[] = isLibrary ? [] : [definePou(input.language)]

  const deviceConfiguration = getDefaultSchemaValues(
    projectDefaultFilesMapSchema['devices/configuration.json'],
  ) as DeviceConfiguration
  const devicePinMapping = getDefaultSchemaValues(
    projectDefaultFilesMapSchema['devices/pin-mapping.json'],
  ) as DevicePin[]

  return {
    project,
    pous,
    deviceConfiguration,
    devicePinMapping,
    ...(isLibrary ? { libraryManifest: buildLibraryManifestTemplate(input.name) } : {}),
  }
}
