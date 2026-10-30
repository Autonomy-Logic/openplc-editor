/**
 * EsiPort — Abstracts ESI (EtherCAT Slave Information) repository management.
 *
 * The ESI repository stores parsed EtherCAT device description files (XML)
 * for use in device configuration.
 *
 * Every platform uses the same implementation, `createEsiRepositoryPort`
 * (`backend/shared/ethercat/esi-repository-port.ts`). Platforms only
 * supply mechanisms (`esi-repository-mechanisms.ts`): where the shared parser
 * runs and where files are stored. Never implement this port per platform.
 */

import type { ESIDevice, ESIModule, ESIRepositoryItemLight } from './esi-types'
import type { Result } from './types'

export interface EsiPort {
  /**
   * Load the ESI repository as lightweight items. Rows written by an older
   * Editor are re-parsed and updated as they load, so needsMigration is false.
   */
  loadRepositoryLight(): Promise<Result<{ items: ESIRepositoryItemLight[]; needsMigration?: boolean }>>

  /**
   * Same as loadRepositoryLight; kept for callers that still handle a
   * separate migration step.
   */
  migrateRepository(): Promise<Result<{ items: ESIRepositoryItemLight[] }>>

  /**
   * Parse an ESI XML file and save it to the repository.
   * The filename and raw XML content are provided; the shared parser builds the row.
   *
   * On success, `item` is present when the file was newly added, and omitted
   * with `duplicate: true` when the file is considered a duplicate — letting
   * callers distinguish a real add from a silent skip.
   *
   * A file is a duplicate when the repository already holds identical bytes
   * (SHA-256 of the content), whatever its filename.
   *
   * `dedupAfterRetry` is never set by the shared implementation: a retried
   * upload that the store already kept comes back as a normal `item`.
   */
  parseAndSaveFile(
    filename: string,
    content: string,
  ): Promise<Result<{ item?: ESIRepositoryItemLight; duplicate?: boolean; dedupAfterRetry?: boolean }>>

  /**
   * Delete a single repository item and its associated XML file.
   */
  deleteRepositoryItem(itemId: string): Promise<Result>

  /**
   * Clear the entire ESI repository (bulk delete all files + reset index).
   */
  clearRepository(): Promise<Result>

  /**
   * Load a full ESI device on-demand (with PDOs, sync managers, FMMU, CoE).
   * This is called when the user selects a device for detailed configuration.
   */
  loadDeviceFull(itemId: string, deviceIndex: number): Promise<Result<{ device: ESIDevice }>>

  /**
   * Load a full ESIModule by ident from a repository item that holds standalone module
   * definitions (ETG.5001 `<Modules>` or `<Devices>`-wrapped modules).  Used when the
   * caller cannot reach the module through `loadDeviceFull` because the ESI file has
   * no `<Device>` block of its own.  Returns the matching module or an error naming the
   * ident.
   */
  loadModuleFull(itemId: string, ident: string): Promise<Result<{ module: ESIModule }>>
}
