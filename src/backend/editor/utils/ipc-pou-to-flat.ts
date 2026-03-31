import type { PLCPou as FlatPou } from '@root/middleware/shared/ports/types'
import type { PLCPou as IpcPou } from '@root/types/PLC/open-plc'

/**
 * Convert the editor backend's nested IPC POU format to the flat port POU
 * format expected by shared utilities (e.g. serializePouToText).
 */
export function ipcPouToFlat(pou: IpcPou): FlatPou & { variablesText?: string } {
  return {
    name: pou.data.name,
    pouType: pou.type as FlatPou['pouType'],
    interface: {
      returnType: 'returnType' in pou.data ? (pou.data as { returnType?: string }).returnType : undefined,
      variables: pou.data.variables as FlatPou['interface']['variables'],
    },
    body: pou.data.body as FlatPou['body'],
    documentation: pou.data.documentation,
    variablesText: 'variablesText' in pou.data ? pou.data.variablesText : undefined,
  }
}
