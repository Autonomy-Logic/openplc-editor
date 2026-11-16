/**
 * Editor EsiPort adapter: the shared ESI repository port on the desktop's
 * mechanisms. The parser runs in the main process and files are read and
 * written in the project's `devices/esi` folder, both over the Electron bridge.
 */

import { createFileEsiRowStore } from '../../../backend/shared/ethercat/esi-file-store'
import { createEsiRepositoryPort } from '../../../backend/shared/ethercat/esi-repository-port'
import type { EsiPort } from '../../shared/ports/esi-port'
import type { EsiFileStore, EsiParserMechanism } from '../../shared/ports/esi-repository-mechanisms'

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string }

function unwrap<T>(outcome: Outcome<T>): T {
  if (!outcome.ok) throw new Error(outcome.error)
  return outcome.value
}

export function createEditorEsiAdapter(
  getProjectPath: () => string,
  onProjectPathChanged?: (listener: () => void) => () => void,
): EsiPort {
  function projectPath(): string {
    const path = getProjectPath()
    if (!path) throw new Error('No project path available')
    return path
  }

  const parser: EsiParserMechanism = {
    run: (request) => window.bridge.esiParse(request),
  }

  const files: EsiFileStore = {
    read: async (name) => unwrap(await window.bridge.esiFileRead(projectPath(), name)),
    write: async (name, text) => unwrap(await window.bridge.esiFileWrite(projectPath(), name, text)),
    remove: async (name) => unwrap(await window.bridge.esiFileRemove(projectPath(), name)),
    list: async () => unwrap(await window.bridge.esiFileList(projectPath())),
    ...(onProjectPathChanged && { onScopeChanged: onProjectPathChanged }),
  }

  return createEsiRepositoryPort({ parser, store: createFileEsiRowStore(files) })
}
