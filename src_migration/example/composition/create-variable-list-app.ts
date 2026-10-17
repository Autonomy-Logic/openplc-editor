import { createVariableListService, type VariablePersistencePort } from '../application'
import type { CommandResult, VariableListApi } from '../contracts/application'
import type { VariableListController } from '../contracts/presentation'
import { createLocalStoragePersistence, type KeyValueStorage } from '../infrastructure'
import { createVariableListController } from '../presentation'
import { createVariableDocumentStore } from '../state'

export const VARIABLE_LIST_STORAGE_KEY = 'openplc-migration-example/variables'

/**
 * One running instance of the feature. Callers get contracts (`api`, `controller`), never the store, the
 * service or the adapters behind them.
 */
export interface VariableListApp {
  readonly api: VariableListApi
  readonly controller: VariableListController
  readonly start: () => Promise<CommandResult>
  readonly dispose: () => void
}

export interface VariableListAppOptions {
  readonly persistence: VariablePersistencePort
}

/**
 * Composition root: the only place where concrete implementations meet. It builds state, use cases and
 * controller with plain factories (no DI container) and owns their lifetime through `dispose`.
 */
export function createVariableListApp({ persistence }: VariableListAppOptions): VariableListApp {
  // Built from the inside out: state, then the use cases that need it, then the controller that needs those.
  const state = createVariableDocumentStore()
  const service = createVariableListService({ state, persistence })
  const presenter = createVariableListController(service)

  return {
    api: service,
    controller: presenter,
    start: service.load,
    // Released from the outside in, so no listener fires into an already disposed layer.
    dispose: () => {
      presenter.dispose()
      service.dispose()
    },
  }
}

/** Platform-specific wiring: the same app, persisted to Web Storage. Works in a browser and in the Electron renderer. */
export function createBrowserVariableListApp(storage: KeyValueStorage): VariableListApp {
  return createVariableListApp({ persistence: createLocalStoragePersistence(storage, VARIABLE_LIST_STORAGE_KEY) })
}
