import { useOpenPLCStore } from '@root/renderer/store'
import { useCallback, useMemo } from 'react'

/**
 * Hook that returns a memoized function to build composite keys for debug variable lookups.
 * Handles both program POUs (simple `pouName:variableName` format) and function block POUs
 * (resolved to `programName:fbVariableName.variableName` using the selected FB instance context).
 */
export const useDebugCompositeKey = () => {
  const {
    editor,
    project: {
      data: { pous },
    },
    workspace: { fbSelectedInstance, fbDebugInstances },
  } = useOpenPLCStore()

  const pouRef = pous.find((p) => p.data.name === editor.meta.name)

  const fbInstanceContext = useMemo(() => {
    if (!pouRef || pouRef.type !== 'function-block') return null
    const fbTypeKey = pouRef.data.name.toUpperCase()
    const selectedKey = fbSelectedInstance.get(fbTypeKey)
    if (!selectedKey) return null
    const instances = fbDebugInstances.get(fbTypeKey) || []
    return instances.find((inst) => inst.key === selectedKey) || null
  }, [pouRef, fbSelectedInstance, fbDebugInstances])

  const getCompositeKey = useCallback(
    (variableName: string): string => {
      if (fbInstanceContext) {
        return `${fbInstanceContext.programName}:${fbInstanceContext.fbVariableName}.${variableName}`
      }
      return `${editor.meta.name}:${variableName}`
    },
    [fbInstanceContext, editor.meta.name],
  )

  return getCompositeKey
}
