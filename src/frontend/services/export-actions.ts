/**
 * Export the live project as PLCopen XML.
 *
 * Converts the store's flat port-shape `PLCProjectData`
 * (`middleware/shared/ports/types.ts`) into the discriminated-union schema
 * shape `XmlGenerator` consumes (`middleware/shared/ports/open-plc-types.ts`
 * — nested `{type,data:{...}}` POUs, singular `configuration`), generates the
 * XML, and hands it to the platform port for persistence (native save dialog
 * on desktop, browser download on web).
 *
 * The conversion mirrors the web compiler adapter's `portToSchemaProjectData`
 * (`middleware/adapters/web/compiler-adapter.ts`) but is kept local and
 * stripped of compile-only concerns (`originalCppPous` and other preprocessor
 * sidecars) since this is a plain export, not a compile.
 */

import { XmlGenerator } from '../../backend/shared/utils/PLC/xml-generator'
import type { PLCProjectData as SchemaPLCProjectData } from '../../middleware/shared/ports/open-plc-types'
import type { ProjectPort } from '../../middleware/shared/ports/project-port'
import type { PLCProjectData, PouLanguage } from '../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../store'
import { toast } from '../utils/toast'

/**
 * Convert the store's flat port-shape project data into the nested
 * schema shape `XmlGenerator` expects. See file header for context.
 *
 * The port-shape `PLCBody.language` field carries a broader union
 * (upper- and lower-case variants, see `types.ts`) than the schema
 * shape expects — at runtime it's always the lowercase `PouLanguage`
 * form every other consumer (save/serialize) already assumes, so the
 * narrowing cast below is the same invariant the rest of the codebase
 * relies on, not a new assumption.
 */
function portToSchemaProjectData(input: PLCProjectData): SchemaPLCProjectData {
  const pous = input.pous.map((pou) => {
    const variables = pou.interface?.variables ?? []
    const language = pou.body.language as PouLanguage
    if (pou.pouType === 'function') {
      return {
        type: 'function' as const,
        data: {
          language,
          name: pou.name,
          returnType: pou.interface?.returnType ?? 'BOOL',
          variables,
          body: pou.body,
          documentation: pou.documentation ?? '',
        },
      }
    }
    if (pou.pouType === 'function-block') {
      return {
        type: 'function-block' as const,
        data: {
          language,
          name: pou.name,
          variables,
          body: pou.body,
          documentation: pou.documentation ?? '',
        },
      }
    }
    return {
      type: 'program' as const,
      data: {
        language,
        name: pou.name,
        variables,
        body: pou.body,
        documentation: pou.documentation ?? '',
      },
    }
  })

  return {
    pous,
    dataTypes: input.dataTypes,
    // `globalVariableLists` is deliberately absent, not forgotten: PLCopen XML has
    // no element for a GVL, and this projection feeds `XmlGenerator` only. A list
    // survives a project through `project.json`; it is the CODESYS converter, not
    // this exporter, that writes one back out.
    configuration: {
      resource: {
        tasks: input.configurations.resource.tasks,
        instances: input.configurations.resource.instances,
        globalVariables: input.configurations.resource.globalVariables,
      },
    },
    servers: input.servers ?? [],
    remoteDevices: input.remoteDevices ?? [],
  } as SchemaPLCProjectData
}

/**
 * Export the currently open project as a PLCopen XML file.
 * Equivalent to File → "Export to PLCOpen XML".
 */
export async function executeExportPlcopen(projectPort: ProjectPort): Promise<{ success: boolean }> {
  const state = openPLCStoreBase.getState()

  try {
    const schemaData = portToSchemaProjectData(state.project.data)
    const xmlResult = XmlGenerator(schemaData, 'old-editor')

    if (!xmlResult.ok || !xmlResult.data) {
      toast({
        title: 'Error exporting PLCopen XML',
        description: xmlResult.message || 'Failed to generate the PLCopen XML.',
        variant: 'fail',
      })
      return { success: false }
    }

    const fileName = `${state.project.meta.name}.xml`
    const exportResult = await projectPort.exportPlcopenFile(fileName, xmlResult.data)

    if (!exportResult.success) {
      toast({
        title: 'Error exporting PLCopen XML',
        description: exportResult.error ?? 'Failed to save the exported file.',
        variant: 'fail',
      })
      return { success: false }
    }

    toast({
      title: 'Project exported',
      description: `"${fileName}" was exported successfully.`,
      variant: 'default',
    })
    return { success: true }
  } catch (err) {
    toast({
      title: 'Error exporting PLCopen XML',
      description: err instanceof Error ? err.message : 'An unexpected error occurred while exporting.',
      variant: 'fail',
    })
    return { success: false }
  }
}
