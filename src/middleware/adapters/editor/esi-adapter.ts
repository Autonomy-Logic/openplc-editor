/**
 * Editor EsiPort adapter: the shared ESI repository port
 * (`middleware/shared/utils/ethercat/esi-repository.ts`) on the desktop's
 * mechanisms. The parser runs in the main process and files live in the
 * project's `devices/esi/` folder, both reached over the Electron bridge.
 * Nothing here interprets results; it only moves them.
 */

import type { EsiPort } from '../../shared/ports/esi-port'
import type { EsiParserMechanism, EsiStoreMechanism } from '../../shared/ports/esi-repository-mechanisms'
import { createEsiRepositoryPort } from '../../shared/utils/ethercat/esi-repository'

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.value
}

export function createEditorEsiAdapter(getProjectPath: () => string): EsiPort {
  function projectPath(): string {
    const path = getProjectPath()
    if (!path) throw new Error('No project path available')
    return path
  }

  const parser: EsiParserMechanism = {
    run: (request) => window.bridge.esiParse(request),
  }

  const store: EsiStoreMechanism = {
    list: async () => unwrap(await window.bridge.esiStoreList(projectPath())),
    upload: async (input) => unwrap(await window.bridge.esiStoreUpload(projectPath(), input)),
    saveSummary: async (id, summary) => unwrap(await window.bridge.esiStoreSaveSummary(projectPath(), id, summary)),
    remove: async (id) => unwrap(await window.bridge.esiStoreRemove(projectPath(), id)),
    clear: async () => unwrap(await window.bridge.esiStoreClear(projectPath())),
    readXml: async (id) => unwrap(await window.bridge.esiStoreReadXml(projectPath(), id)),
  }

  return createEsiRepositoryPort({ parser, store })
}
