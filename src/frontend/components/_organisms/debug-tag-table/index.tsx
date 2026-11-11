import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { PLCMonitorView } from '../../../../middleware/shared/ports/types'
import {
  useDebugBoolValuesMap,
  useDebugForcedVariablesMap,
  useDebugNonBoolValuesMap,
} from '../../../hooks/use-debug-value'
import { useOpenPLCStore } from '../../../store'
import { cn } from '../../../utils/cn'
import {
  assignTagToView,
  buildTagRows,
  createMonitorView,
  filterTagRows,
  nextMonitorViewName,
  pruneMonitorViews,
  removeMonitorView,
  rowsOfView,
  type TagRow,
} from '../../../utils/debug-tag-table'
import { encodeForceValue, isForcedValueHigh } from '../../../utils/variable-sizes'
import { toast } from '../../_features/[app]/toast/use-toast'

const ALL_TAGS = ''
const PROJECT_FILE = 'Resource'

type DebugTagTableProps = {
  onForceVariable: (
    compositeKey: string,
    variableType: string,
    value?: boolean,
    valueBuffer?: Uint8Array,
    lookupKey?: string,
  ) => Promise<void>
}

const columnClass = 'px-2 py-1 text-left font-medium'

const DebugTagTable = ({ onForceVariable }: DebugTagTableProps) => {
  const pous = useOpenPLCStore(useCallback((s) => s.project.data.pous, []))
  const globalVariables = useOpenPLCStore(
    useCallback((s) => s.project.data.configurations.resource.globalVariables, []),
  )
  const globalVariableLists = useOpenPLCStore(useCallback((s) => s.project.data.globalVariableLists, []))
  const monitorViews = useOpenPLCStore(useCallback((s) => s.project.data.monitorViews, []))
  const setMonitorViews = useOpenPLCStore(useCallback((s) => s.projectActions.setMonitorViews, []))
  const debugVariableTree = useOpenPLCStore(useCallback((s) => s.workspace.debugVariableTree, []))
  const debugVariableIndexes = useOpenPLCStore(useCallback((s) => s.workspace.debugVariableIndexes, []))
  const setDebugTagTableKeys = useOpenPLCStore(useCallback((s) => s.workspaceActions.setDebugTagTableKeys, []))
  const handleFileAndWorkspaceSavedState = useOpenPLCStore(
    useCallback((s) => s.sharedWorkspaceActions.handleFileAndWorkspaceSavedState, []),
  )
  const debugBoolValues = useDebugBoolValuesMap()
  const debugNonBoolValues = useDebugNonBoolValuesMap()
  const debugForcedVariables = useDebugForcedVariablesMap()

  const [filter, setFilter] = useState('')
  const [activeView, setActiveView] = useState(ALL_TAGS)
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set())
  const [forceDrafts, setForceDrafts] = useState<Record<string, string>>({})

  const views: PLCMonitorView[] = useMemo(() => monitorViews ?? [], [monitorViews])

  // The views live in project.json, which only a project save writes.
  const commitViews = useCallback(
    (next: PLCMonitorView[]) => {
      setMonitorViews(next)
      handleFileAndWorkspaceSavedState(PROJECT_FILE)
    },
    [setMonitorViews, handleFileAndWorkspaceSavedState],
  )

  const allRows = useMemo(
    () =>
      buildTagRows({
        trees: Array.from(debugVariableTree.values()),
        pous,
        globalVariables,
        globalVariableLists,
        views,
        expandedKeys,
      }),
    [debugVariableTree, pous, globalVariables, globalVariableLists, views, expandedKeys],
  )

  const rows = useMemo(
    () => filterTagRows(rowsOfView(allRows, views, activeView), filter),
    [allRows, views, activeView, filter],
  )

  const publishedKeysRef = useRef('')
  useEffect(() => {
    const keys = rows.map((row) => row.compositeKey)
    const fingerprint = keys.join('\u0000')
    if (fingerprint === publishedKeysRef.current) return
    publishedKeysRef.current = fingerprint
    setDebugTagTableKeys(keys)
  }, [rows, setDebugTagTableKeys])

  // The table is the only reason these tags are polled, so closing it has to stop the reads.
  useEffect(() => {
    return () => {
      publishedKeysRef.current = ''
      setDebugTagTableKeys([])
    }
  }, [setDebugTagTableKeys])

  useEffect(() => {
    if (activeView !== ALL_TAGS && !views.some((view) => view.name === activeView)) {
      setActiveView(ALL_TAGS)
    }
  }, [views, activeView])

  // An empty tree means the session has not published its variables yet, not that they are gone.
  useEffect(() => {
    if (debugVariableTree.size === 0 || views.length === 0) return
    const pruned = pruneMonitorViews(views, new Set(debugVariableTree.keys()))
    const changed = pruned.some((view, index) => view.entries.length !== views[index].entries.length)
    // No unsaved marker: opening the table is not an edit the user made.
    if (changed) setMonitorViews(pruned)
  }, [debugVariableTree, views, setMonitorViews])

  const toggleExpanded = useCallback((compositeKey: string) => {
    setExpandedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(compositeKey)) next.delete(compositeKey)
      else next.add(compositeKey)
      return next
    })
  }, [])

  const handleCreateView = useCallback(() => {
    const name = nextMonitorViewName(views)
    const result = createMonitorView(views, name)
    if (result.error) {
      toast({ title: 'Cannot create the view', description: result.error, variant: 'fail' })
      return
    }
    commitViews(result.views)
    setActiveView(name)
  }, [views, commitViews])

  const handleRemoveView = useCallback(() => {
    if (activeView === ALL_TAGS) return
    commitViews(removeMonitorView(views, activeView))
    setActiveView(ALL_TAGS)
  }, [activeView, views, commitViews])

  const handleAreaChange = useCallback(
    (compositeKey: string, viewName: string) => {
      commitViews(assignTagToView(views, compositeKey, viewName))
    },
    [views, commitViews],
  )

  const lookupKeyOf = useCallback((row: TagRow) => (row.debugIndex !== undefined ? row.fullPath : row.compositeKey), [])

  const canForce = useCallback(
    (row: TagRow) =>
      !row.isComplex &&
      (row.debugIndex !== undefined ||
        debugVariableIndexes.has(row.fullPath) ||
        debugVariableIndexes.has(row.compositeKey)),
    [debugVariableIndexes],
  )

  const handleForceBool = useCallback(
    (row: TagRow, value: boolean) => {
      void onForceVariable(row.compositeKey, 'BOOL', value, undefined, lookupKeyOf(row))
    },
    [onForceVariable, lookupKeyOf],
  )

  const handleRelease = useCallback(
    (row: TagRow) => {
      void onForceVariable(row.compositeKey, row.type, undefined, undefined, lookupKeyOf(row))
    },
    [onForceVariable, lookupKeyOf],
  )

  const handleForceValue = useCallback(
    (row: TagRow) => {
      const draft = forceDrafts[row.compositeKey]?.trim()
      if (!draft) return

      let valueBuffer: Uint8Array
      try {
        valueBuffer = encodeForceValue(draft, row.type, row.enumValues)
      } catch (error) {
        toast({
          title: 'Cannot force value',
          description: error instanceof Error ? error.message : String(error),
          variant: 'fail',
        })
        return
      }

      void onForceVariable(row.compositeKey, row.type, isForcedValueHigh(draft), valueBuffer, lookupKeyOf(row))
      setForceDrafts((previous) => ({ ...previous, [row.compositeKey]: '' }))
    },
    [forceDrafts, onForceVariable, lookupKeyOf],
  )

  const renderForceCell = (row: TagRow) => {
    if (!canForce(row)) return <span className='text-neutral-400 dark:text-neutral-700'>-</span>

    const isForced = debugForcedVariables.has(row.compositeKey)
    const isBool = row.type.toUpperCase() === 'BOOL'

    return (
      <div className='flex items-center gap-1'>
        {isBool ? (
          <>
            <button
              type='button'
              aria-label={`Force ${row.name} true`}
              className='h-5 w-5 rounded border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-850'
              onClick={() => handleForceBool(row, true)}
            >
              1
            </button>
            <button
              type='button'
              aria-label={`Force ${row.name} false`}
              className='h-5 w-5 rounded border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-850'
              onClick={() => handleForceBool(row, false)}
            >
              0
            </button>
          </>
        ) : (
          <input
            aria-label={`Force value for ${row.name}`}
            className='h-5 w-20 rounded border border-neutral-300 bg-transparent px-1 outline-none focus:border-brand dark:border-neutral-700'
            value={forceDrafts[row.compositeKey] ?? ''}
            onChange={(event) =>
              setForceDrafts((previous) => ({ ...previous, [row.compositeKey]: event.target.value }))
            }
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleForceValue(row)
            }}
          />
        )}
        {isForced && (
          <button
            type='button'
            aria-label={`Release ${row.name}`}
            className='h-5 rounded border border-neutral-300 px-1 text-brand hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-850'
            onClick={() => handleRelease(row)}
          >
            release
          </button>
        )}
      </div>
    )
  }

  return (
    <div className='flex h-full w-full flex-col gap-2 overflow-hidden rounded-lg border-[0.75px] border-neutral-200 bg-white p-2 text-cp-sm text-neutral-1000 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-50'>
      <div className='flex flex-wrap items-center gap-2'>
        <select
          aria-label='Monitor view'
          className='h-7 rounded-md border border-neutral-200 bg-transparent px-2 outline-none dark:border-neutral-800'
          value={activeView}
          onChange={(event) => setActiveView(event.target.value)}
        >
          <option value={ALL_TAGS}>All tags</option>
          {views.map((view) => (
            <option key={view.name} value={view.name}>
              {view.name}
            </option>
          ))}
        </select>
        <button type='button' className='h-7 rounded-md bg-brand px-2 text-white' onClick={handleCreateView}>
          New view
        </button>
        <button
          type='button'
          className='h-7 rounded-md border border-neutral-200 px-2 disabled:opacity-50 dark:border-neutral-800'
          disabled={activeView === ALL_TAGS}
          onClick={handleRemoveView}
        >
          Delete view
        </button>
        <input
          aria-label='Filter tags'
          placeholder='Filter'
          className='h-7 w-48 rounded-md border border-neutral-200 bg-transparent px-2 outline-none focus:border-brand dark:border-neutral-800'
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
        <span className='text-neutral-500 dark:text-neutral-400'>
          {rows.length} of {allRows.length} tags
        </span>
      </div>

      <div className='h-full overflow-auto'>
        <table className='w-full border-collapse whitespace-nowrap'>
          <thead className='sticky top-0 bg-white dark:bg-neutral-900'>
            <tr className='border-b border-neutral-200 dark:border-neutral-800'>
              <th className={columnClass}>Name</th>
              <th className={columnClass}>Value</th>
              <th className={columnClass}>Area</th>
              <th className={columnClass}>Address</th>
              <th className={columnClass}>Force</th>
              <th className={columnClass}>Type</th>
              <th className={columnClass}>Comment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const value = debugBoolValues.get(row.compositeKey) ?? debugNonBoolValues.get(row.compositeKey)
              const isForced = debugForcedVariables.has(row.compositeKey)
              return (
                <tr
                  key={row.compositeKey}
                  className={cn(
                    'border-b border-neutral-100 dark:border-neutral-850',
                    isForced && 'bg-green-100 dark:bg-green-900/30',
                  )}
                >
                  <td className='px-2 py-1' style={{ paddingLeft: `${8 + row.depth * 14}px` }}>
                    <div className='flex items-center gap-1'>
                      {row.hasChildren ? (
                        <button
                          type='button'
                          aria-label={`Expand ${row.name}`}
                          aria-expanded={expandedKeys.has(row.compositeKey)}
                          className='h-4 w-4 text-neutral-500'
                          onClick={() => toggleExpanded(row.compositeKey)}
                        >
                          {expandedKeys.has(row.compositeKey) ? '-' : '+'}
                        </button>
                      ) : (
                        <span className='h-4 w-4' />
                      )}
                      <span>{row.name}</span>
                      <span className='text-neutral-400 dark:text-neutral-600'>{row.scope}</span>
                    </div>
                  </td>
                  <td className='px-2 py-1 font-medium'>{row.isComplex ? '-' : (value ?? '-')}</td>
                  <td className='px-2 py-1'>
                    <select
                      aria-label={`Area of ${row.name}`}
                      className='h-6 rounded border border-neutral-200 bg-transparent px-1 outline-none dark:border-neutral-800'
                      value={row.area}
                      onChange={(event) => handleAreaChange(row.compositeKey, event.target.value)}
                    >
                      <option value={ALL_TAGS}>-</option>
                      {views.map((view) => (
                        <option key={view.name} value={view.name}>
                          {view.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className='px-2 py-1 text-neutral-500 dark:text-neutral-400'>{row.address || '-'}</td>
                  <td className='px-2 py-1'>{renderForceCell(row)}</td>
                  <td className='px-2 py-1 uppercase text-neutral-500 dark:text-neutral-400'>{row.type}</td>
                  <td className='px-2 py-1 text-neutral-500 dark:text-neutral-400'>{row.comment}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <p className='p-2 text-neutral-500 dark:text-neutral-400'>No tag matches the current view and filter.</p>
        )}
      </div>
    </div>
  )
}

export { DebugTagTable }
