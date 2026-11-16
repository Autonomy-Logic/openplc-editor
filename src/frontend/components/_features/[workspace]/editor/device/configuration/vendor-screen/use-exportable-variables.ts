import { createProjectPlcModel } from '@root/frontend/services/plc-model/project-plc-model'
import { useOpenPLCStoreApi } from '@root/frontend/store'
import type { ExportableVariable } from '@root/middleware/shared/vendor-document/protocol'
import { useEffect, useMemo, useState } from 'react'

/**
 * Subscribes a VPP screen component to the project's exportable variable set.
 *
 * Returns the list under the same contract the vendor-document `getPlcVariables`
 * host query returns, so screens migrated from the iframe keep their row source
 * unchanged. The underlying `createProjectPlcModel` fires `onModelChanged` only
 * when the fingerprint of program/global variables shifts, so edits elsewhere
 * (editor tabs, debugger) do not cause spurious re-renders.
 */
export function useExportableVariables(): ReadonlyArray<ExportableVariable> {
  const store = useOpenPLCStoreApi()
  const model = useMemo(() => createProjectPlcModel(store), [store])
  const [variables, setVariables] = useState<ReadonlyArray<ExportableVariable>>(() => model.listExportableVariables())

  useEffect(() => {
    setVariables(model.listExportableVariables())
    const unsubscribe = model.onModelChanged(() => {
      setVariables(model.listExportableVariables())
    })
    return unsubscribe
  }, [model])

  return variables
}
