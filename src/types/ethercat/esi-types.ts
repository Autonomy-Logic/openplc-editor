/**
 * EtherCAT Slave Information (ESI) Types — re-export barrel.
 *
 * Canonical definitions live in src/middleware/shared/ports/esi-types.ts
 * (a shared surface synced between openplc-editor and openplc-web).
 *
 * This file re-exports everything so existing consumers that import from
 * `@root/types/ethercat/esi-types` continue working without changes.
 */
export * from '../../middleware/shared/ports/esi-types'
