/**
 * EsiPort — Abstracts ESI (EtherCAT Slave Information) repository management.
 *
 * The ESI repository stores parsed EtherCAT device description files (XML)
 * for use in device configuration. The persistence mechanism differs between
 * platforms:
 *
 * Editor adapter: Delegates to main process ESIService which reads/writes
 *                 XML files and a JSON index in the project's devices/esi/ directory.
 * Web adapter:    Will delegate to a backend API for ESI file management.
 *
 * All parsing and processing happens in the shared backend
 * (src/backend/shared/ethercat/). The port only handles persistence I/O.
 */

import type { ESIDevice, ESIRepositoryItemLight } from './esi-types'
import type { Result } from './types'

export interface EsiPort {
  /**
   * Load the ESI repository as lightweight items (instant from v2 cached index).
   * Returns needsMigration=true if the repository is in v1 format.
   */
  loadRepositoryLight(): Promise<Result<{ items: ESIRepositoryItemLight[]; needsMigration?: boolean }>>

  /**
   * Migrate a v1 repository to v2 format with device summaries.
   * Returns the updated list of lightweight items.
   */
  migrateRepository(): Promise<Result<{ items: ESIRepositoryItemLight[] }>>

  /**
   * Parse an ESI XML file and save it to the repository.
   * The filename and raw XML content are provided; parsing happens on the backend.
   */
  parseAndSaveFile(filename: string, content: string): Promise<Result<{ item: ESIRepositoryItemLight }>>

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
}
