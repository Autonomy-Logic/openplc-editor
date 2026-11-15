/**
 * Project HMI → ST language server: every screen and widget block as a document, screens marked so their instance paths
 * (`instance0.Main.Run`) resolve, the navigation and theme declarations the HMI build generates for the screens, and
 * the HMI libraries once the project has an HMI file. Screens are re-sent when the PLC program or the HMI around them
 * changes, since the server analyses each document on its own changes only.
 */
import type { HmiPreviewPort } from '../../../middleware/shared/ports/hmi-preview-port'
import { defaultHmiSettings } from '../../../middleware/shared/utils/hmi/settings'
import type { OpenPLCStore } from '../../store'
import { hmiFileUri } from '../hmi-code/uris'
import { deleteBodyLineOffset, setBodyLineOffset } from '../lsp-shared/body-offsets'
import type { StLspService } from './types'

/** What the HMI build generates for screens: navigation by screen name and theme ids. */
export const HMI_GLUE_URI = 'inmemory://hmi-glue/__hmi__.st'

/** The pragma the HMI build puts on every screen; here on a line of its own before the source. */
export const HMI_INSTANCE_PATHS_PRAGMA = "{attribute 'instance_paths'}"

const REPUBLISH_DELAY_MS = 400

export interface HmiSyncHandle {
  /** The HMI libraries as `loadStlibBuffer` payloads; none while the project has no HMI file. */
  libraries(): Promise<Array<{ sourceLabel: string; payload: string }>>
  /** Upper-case members of HmiScreen, which elements may not reuse; empty until the libraries load. */
  screenMembers(): ReadonlySet<string>
  dispose(): void
}

export function attachHmiSync(
  store: OpenPLCStore,
  service: StLspService,
  preview: HmiPreviewPort,
  /** Pushes the stlibs again and re-analyses every document, once the project gains its first HMI file. */
  reloadLibraries: () => Promise<void>,
): HmiSyncHandle {
  const sent = new Map<string, string>()
  let version = 0
  let disposed = false
  let librariesLoaded = false
  let members: ReadonlySet<string> = new Set()
  let glueKey = ''
  let republishTimer: ReturnType<typeof setTimeout> | null = null

  const hmiOf = () => {
    const hmi = store.getState().project.data.hmi
    return {
      screens: hmi?.screens ?? [],
      widgets: hmi?.widgets ?? [],
      settings: hmi?.settings ?? defaultHmiSettings(),
    }
  }
  const hasHmi = (): boolean => {
    const { screens, widgets } = hmiOf()
    return screens.length + widgets.length > 0
  }

  const send = (uri: string, text: string, force = false): void => {
    if (disposed) return
    const previous = sent.get(uri)
    if (previous === undefined) service.openDocument(uri, text)
    else if (previous !== text || force) service.changeDocument(uri, text, ++version)
    else return
    sent.set(uri, text)
  }
  const close = (uri: string): void => {
    service.closeDocument(uri)
    sent.delete(uri)
    deleteBodyLineOffset(uri)
  }

  const reconcileGlue = async (): Promise<void> => {
    const { screens, settings } = hmiOf()
    const key = JSON.stringify([screens.map((s) => s.name), settings.themes.map((t) => t.name)])
    if (key === glueKey) return
    glueKey = key
    const { glue, screenMembers } = await preview.codeContext({ screens, settings })
    if (disposed || key !== glueKey) return
    members = new Set(screenMembers)
    if (glue === '') {
      if (sent.has(HMI_GLUE_URI)) close(HMI_GLUE_URI)
    } else if (sent.get(HMI_GLUE_URI) !== glue) {
      send(HMI_GLUE_URI, glue)
      republish()
    }
  }

  const reconcileFiles = (force = false): void => {
    const { screens, widgets } = hmiOf()
    const wanted = new Map<string, string>()
    for (const s of screens) {
      const uri = hmiFileUri('screen', s.name)
      setBodyLineOffset(uri, 1)
      wanted.set(uri, `${HMI_INSTANCE_PATHS_PRAGMA}\n${s.source}`)
    }
    for (const w of widgets) wanted.set(hmiFileUri('widget', w.name), w.source)
    for (const [uri, text] of wanted) send(uri, text, force)
    for (const uri of [...sent.keys()]) if (uri !== HMI_GLUE_URI && !wanted.has(uri)) close(uri)
  }

  /** Re-sends every screen and widget block unchanged, so the server analyses them against what moved around them. */
  function republish(): void {
    if (republishTimer) clearTimeout(republishTimer)
    republishTimer = setTimeout(() => {
      republishTimer = null
      reconcileFiles(true)
    }, REPUBLISH_DELAY_MS)
  }

  const reconcile = (): void => {
    if (disposed) return
    if (hasHmi() && !librariesLoaded) {
      librariesLoaded = true
      void reloadLibraries().catch((error: unknown) => console.warn('[strucpp-lsp] HMI libraries:', error))
    } else if (!hasHmi()) librariesLoaded = false
    reconcileFiles()
    void reconcileGlue().catch((error: unknown) => console.warn('[strucpp-lsp] HMI declarations:', error))
  }

  const unsubscribeHmi = store.subscribe((s) => s.project.data.hmi, reconcile)
  const unsubscribePous = store.subscribe((s) => s.project.data.pous, republish)
  const unsubscribeResource = store.subscribe((s) => s.project.data.configurations.resource, republish)
  reconcile()

  return {
    async libraries() {
      if (!hasHmi()) return []
      const { libraries, screenMembers } = await preview.codeContext({ screens: [], settings: hmiOf().settings })
      members = new Set(screenMembers)
      return libraries.map((l) => ({ sourceLabel: l.name, payload: l.archiveJson }))
    },
    screenMembers: () => members,
    dispose() {
      disposed = true
      if (republishTimer) clearTimeout(republishTimer)
      unsubscribeHmi()
      unsubscribePous()
      unsubscribeResource()
      for (const uri of [...sent.keys()]) close(uri)
    },
  }
}
