import { produce } from 'immer'
import { StateCreator } from 'zustand'

import { DEFAULT_HMI_DEVICE } from '../../../../middleware/shared/utils/hmi/device-presets'
import type { HmiElementKind } from '../../../../middleware/shared/utils/hmi/references'
import { emptyHistory, recordStep, redoStep, undoStep } from '../../../../middleware/shared/utils/hmi/source-history'
import type { ProjectSlice } from '../project'
import type { SharedSlice } from '../shared'
import type { HmiDesignerEntry, HmiDesignerSlice } from './types'

type HmiDesignerRootState = HmiDesignerSlice & ProjectSlice & SharedSlice

/** Store key of a screen or widget block. */
export const hmiDesignerKey = (kind: HmiElementKind, name: string): string => `${kind}:${name.toUpperCase()}`

/** The designer's state of a screen or widget block, defaults when it has none yet. */
export function hmiDesignerEntry(state: HmiDesignerSlice, kind: HmiElementKind, name: string): HmiDesignerEntry {
  return (
    state.hmiDesigner[hmiDesignerKey(kind, name)] ?? {
      history: emptyHistory(),
      view: 'design',
      device: DEFAULT_HMI_DEVICE,
      zoom: null,
      selection: [],
      lastValidSource: null,
    }
  )
}

function sourceOf(state: ProjectSlice, kind: HmiElementKind, name: string): string | undefined {
  const files = kind === 'screen' ? state.project.data.hmi?.screens : state.project.data.hmi?.widgets
  return files?.find((f) => f.name.toUpperCase() === name.toUpperCase())?.source
}

export const createHmiDesignerSlice: StateCreator<HmiDesignerRootState, [], [], HmiDesignerSlice> = (
  setState,
  getState,
) => {
  const update = (kind: HmiElementKind, name: string, change: (entry: HmiDesignerEntry) => void): void =>
    setState(
      produce((state: HmiDesignerRootState) => {
        const key = hmiDesignerKey(kind, name)
        const entry = state.hmiDesigner[key] ?? hmiDesignerEntry(state, kind, name)
        change(entry)
        state.hmiDesigner[key] = entry
      }),
    )

  const putSource = (kind: HmiElementKind, name: string, source: string): void => {
    getState().projectActions.updateHmiSource(kind, name, source)
    getState().sharedWorkspaceActions.handleFileAndWorkspaceSavedState(name)
  }

  return {
    hmiDesigner: {},
    hmiDesignerActions: {
      applySource: (kind, name, source, merge) => {
        const current = sourceOf(getState(), kind, name)
        if (current === undefined || current === source) return
        update(kind, name, (entry) => {
          entry.history = recordStep(entry.history, current, source, merge)
        })
        putSource(kind, name, source)
      },
      undo: (kind, name) => {
        const current = sourceOf(getState(), kind, name)
        if (current === undefined) return false
        const step = undoStep(hmiDesignerEntry(getState(), kind, name).history, current)
        if (!step) return false
        update(kind, name, (entry) => {
          entry.history = step.history
        })
        putSource(kind, name, step.source)
        return true
      },
      redo: (kind, name) => {
        const current = sourceOf(getState(), kind, name)
        if (current === undefined) return false
        const step = redoStep(hmiDesignerEntry(getState(), kind, name).history, current)
        if (!step) return false
        update(kind, name, (entry) => {
          entry.history = step.history
        })
        putSource(kind, name, step.source)
        return true
      },
      setView: (kind, name, view) => update(kind, name, (entry) => void (entry.view = view)),
      setDevice: (kind, name, device) => update(kind, name, (entry) => void (entry.device = device)),
      setZoom: (kind, name, zoom) => update(kind, name, (entry) => void (entry.zoom = zoom)),
      select: (kind, name, selection) => update(kind, name, (entry) => void (entry.selection = selection)),
      setLastValidSource: (kind, name, source) => update(kind, name, (entry) => void (entry.lastValidSource = source)),
      renameEntry: (kind, oldName, newName) =>
        setState(
          produce((state: HmiDesignerRootState) => {
            const entry = state.hmiDesigner[hmiDesignerKey(kind, oldName)]
            if (!entry) return
            delete state.hmiDesigner[hmiDesignerKey(kind, oldName)]
            state.hmiDesigner[hmiDesignerKey(kind, newName)] = entry
          }),
        ),
      forgetEntry: (kind, name) =>
        setState(
          produce((state: HmiDesignerRootState) => {
            delete state.hmiDesigner[hmiDesignerKey(kind, name)]
          }),
        ),
      clear: () => setState({ hmiDesigner: {} }),
    },
  }
}
