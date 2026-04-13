import type { PLCPou as IpcPou } from '@root/backend/shared/types/PLC/open-plc'
import type { PLCPou as FlatPou } from '@root/middleware/shared/ports/types'

/**
 * Convert the editor backend's nested IPC POU format to the flat port POU
 * format expected by shared utilities (e.g. serializePouToText).
 */
export function ipcPouToFlat(pou: IpcPou): FlatPou & { variablesText?: string } {
  const data = pou.data as Record<string, unknown>
  return {
    name: pou.data.name,
    pouType: pou.type as FlatPou['pouType'],
    interface: {
      returnType: (data.returnType as string | undefined) ?? undefined,
      variables: (data.variables ?? []) as NonNullable<FlatPou['interface']>['variables'],
    },
    body: pou.data.body as FlatPou['body'],
    documentation: pou.data.documentation,
    variablesText: (data.variablesText as string | undefined) ?? undefined,
  }
}
