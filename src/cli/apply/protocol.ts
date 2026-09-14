/**
 * `apply`'s protocol section: servers, remote devices and the EtherCAT bus.
 *
 * The sequencing here is load-bearing rather than incidental. `deleteRemoteDevice`
 * recalculates the project's IEC addresses, and so does every `addIOGroup`, so a
 * per-device create/populate loop costs one project-wide reallocation per group
 * — and lands on different addresses than the same spec applied in a different
 * order. Delete everything, create everything, add every group in spec order,
 * recalculate once at the end.
 *
 * Everything below the store boundary goes through the same actions the device
 * screens use. Nothing here writes `project.data.servers` directly.
 */

import { ESIService } from '@root/backend/editor/ethercat/esi-service'
import { normalizeEthercatSlave } from '@root/backend/shared/protocol/normalize-ethercat-slave'
import type { NormalizedRemoteDevice } from '@root/backend/shared/protocol/normalize-remote-device-spec'
import { normalizeRemoteDeviceSpec } from '@root/backend/shared/protocol/normalize-remote-device-spec'
import { normalizeServerSpec } from '@root/backend/shared/protocol/normalize-server-spec'
import { openPLCStoreBase } from '@root/frontend/store'
import type { ConfiguredEtherCATDevice } from '@root/middleware/shared/ports/esi-types'
import type { PLCRemoteDevice, PLCServer } from '@root/middleware/shared/ports/types'

import type { PlannedChange } from './plan'
import type { ApplySpec, SpecRemoteDevice, SpecServer } from './schema'

/** A server's OPC-UA secrets, kept when the spec omits them. */
interface PreservedSecrets {
  serverPrivateKeyCustom?: string | null
  passwordHashById: Map<string, string | null>
}

export function applyServers(spec: ApplySpec, changes: PlannedChange[], errors: string[]): void {
  if (!spec.servers) return

  const state = () => openPLCStoreBase.getState()
  const existing = state().project.data.servers ?? []
  const preserved = new Map(existing.map((server) => [server.name, collectSecrets(server)]))

  const wanted = spec.servers.map((server) => server.name.toLowerCase())
  const duplicate = wanted.find((name, index) => wanted.indexOf(name) !== index)
  if (duplicate) {
    errors.push(`Two servers in the spec are both named "${duplicate}".`)
    return
  }

  const normalized: PLCServer[] = []
  for (const server of spec.servers) {
    const result = normalizeServerSpec(server)
    if (!result.ok) {
      errors.push(...result.errors)
      continue
    }
    normalized.push(restoreSecrets(result.value, server, preserved.get(server.name)))
  }
  if (errors.length > 0) return

  // Replace rather than patch: `createServer` refuses an existing name, and the
  // granular update actions each cover one nested slice of one protocol.
  // `executeSaveProject` filters `pendingDeletions` against the files it is
  // about to write, so deleting and recreating the same name is not a delete.
  for (const server of normalized) {
    const had = existing.some((entry) => entry.name === server.name)
    if (had) state().projectActions.deleteServer(server.name)
    const response = state().projectActions.createServer({ data: server })
    if (!response.ok) {
      errors.push(`Could not create server "${server.name}": ${response.message ?? 'the store refused it'}`)
      continue
    }
    changes.push({ kind: 'server', action: had ? 'update' : 'create', name: server.name })
  }
}

/**
 * `describe` redacts the private key and every password hash, so a spec that
 * came from `describe` carries neither. Writing `null` in their place would
 * destroy the key on the first round trip.
 */
function collectSecrets(server: PLCServer): PreservedSecrets {
  const config = server.opcuaServerConfig
  return {
    serverPrivateKeyCustom: config?.security.serverPrivateKeyCustom,
    passwordHashById: new Map((config?.users ?? []).map((user) => [user.id, user.passwordHash])),
  }
}

function restoreSecrets(server: PLCServer, spec: SpecServer, preserved: PreservedSecrets | undefined): PLCServer {
  if (!server.opcuaServerConfig || !preserved) return server

  const config = server.opcuaServerConfig
  const keyOmitted = spec.opcua?.security === undefined || !('serverPrivateKeyCustom' in spec.opcua.security)

  return {
    ...server,
    opcuaServerConfig: {
      ...config,
      security: {
        ...config.security,
        serverPrivateKeyCustom: keyOmitted
          ? (preserved.serverPrivateKeyCustom ?? config.security.serverPrivateKeyCustom)
          : config.security.serverPrivateKeyCustom,
      },
      users: config.users.map((user, index) => {
        const written = spec.opcua?.users?.[index]
        if (written && 'passwordHash' in written) return user
        const kept = preserved.passwordHashById.get(user.id)
        return kept === undefined ? user : { ...user, passwordHash: kept }
      }),
    },
  }
}

export async function applyRemoteDevices(
  spec: ApplySpec,
  projectPath: string,
  changes: PlannedChange[],
  errors: string[],
): Promise<void> {
  if (!spec.remoteDevices) return

  const state = () => openPLCStoreBase.getState()

  const wanted = spec.remoteDevices.map((device) => device.name.toLowerCase())
  const duplicate = wanted.find((name, index) => wanted.indexOf(name) !== index)
  if (duplicate) {
    errors.push(`Two remote devices in the spec are both named "${duplicate}".`)
    return
  }

  const normalized: NormalizedRemoteDevice[] = []
  for (const device of spec.remoteDevices) {
    const result = normalizeRemoteDeviceSpec(device)
    if (!result.ok) {
      errors.push(...result.errors)
      continue
    }
    normalized.push(result.value)
  }
  if (errors.length > 0) return

  // EtherCAT slaves are built before anything is written: reading an ESI file
  // can fail, and a half-written bus is worse than an unchanged one.
  const slavesByDevice = await buildEthercatSlaves(spec.remoteDevices, projectPath, errors)
  if (errors.length > 0) return

  const existing = state().project.data.remoteDevices ?? []

  // Delete every device first. Each delete recalculates the project's addresses,
  // so interleaving deletes with creates reallocates repeatedly and lands
  // somewhere different depending on the order.
  for (const device of normalized) {
    if (existing.some((entry) => entry.name === device.device.name)) {
      state().projectActions.deleteRemoteDevice(device.device.name)
    }
  }

  for (const { device } of normalized) {
    const had = existing.some((entry) => entry.name === device.name)
    const response = state().projectActions.createRemoteDevice({ data: device })
    if (!response.ok) {
      errors.push(`Could not create remote device "${device.name}": ${response.message ?? 'the store refused it'}`)
      continue
    }
    changes.push({ kind: 'remote-device', action: had ? 'update' : 'create', name: device.name })
  }

  // Groups in spec order, so the addresses a spec produces are a function of
  // the document rather than of iteration order.
  for (const { device, ioGroups } of normalized) {
    for (const group of ioGroups) {
      const response = state().projectActions.addIOGroup(device.name, group)
      if (!response.ok) {
        errors.push(`Could not add I/O group "${group.name}" to "${device.name}": ${response.message ?? 'refused'}`)
        continue
      }
      changes.push({ kind: 'io-group', action: 'create', name: `${device.name}.${group.name}` })
    }
  }

  // After the groups exist, so the points they name have been allocated.
  for (const { device, aliasesByGroupId } of normalized) {
    for (const [groupId, aliases] of aliasesByGroupId) {
      const stored = state()
        .project.data.remoteDevices?.find((entry) => entry.name === device.name)
        ?.modbusTcpConfig?.ioGroups.find((group) => group.id === groupId)
      if (!stored) continue
      aliases.forEach((alias, index) => {
        const point = stored.ioPoints?.[index]
        if (!point) return
        state().projectActions.updateIOPointAlias(device.name, groupId, point.id, alias)
        changes.push({ kind: 'io-group', action: 'update', name: `${device.name}.${stored.name}[${index}] = ${alias}` })
      })
    }
  }

  for (const { device } of normalized) {
    const slaves = slavesByDevice.get(device.name)
    if (!slaves || device.protocol !== 'ethercat') continue
    const response = state().projectActions.updateEthercatConfig(device.name, {
      masterConfig: device.ethercatConfig?.masterConfig,
      devices: slaves,
    })
    if (!response.ok) {
      errors.push(`Could not configure the EtherCAT bus on "${device.name}": ${response.message ?? 'refused'}`)
      continue
    }
    for (const slave of slaves) {
      changes.push({ kind: 'ethercat-slave', action: 'create', name: `${device.name}.${slave.name}` })
    }
  }

  // One recalculation for the whole section. Every action above triggers its
  // own; this is the one whose result is kept.
  state().projectActions.recalculateIecAddresses()
}

/**
 * Build every EtherCAT slave in the spec, resolving each `repositoryItemId`
 * against the project's own ESI repository.
 *
 * The id may be the repository item's uuid or the file's name. `esi import`
 * mints the uuid, so requiring it would mean importing, reading the id back and
 * pasting it into the spec before anything could be authored.
 */
async function buildEthercatSlaves(
  specs: readonly SpecRemoteDevice[],
  projectPath: string,
  errors: string[],
): Promise<Map<string, ConfiguredEtherCATDevice[]>> {
  const byDevice = new Map<string, ConfiguredEtherCATDevice[]>()
  const withSlaves = specs.filter((device) => (device.ethercat?.slaves ?? []).length > 0)
  if (withSlaves.length === 0) return byDevice

  const esi = new ESIService()
  const index = await esi.loadRepositoryIndex(projectPath)
  if (!index) {
    errors.push('This project has no ESI repository — run `openplc-cli esi import` before declaring EtherCAT slaves.')
    return byDevice
  }

  const xmlCache = new Map<string, string>()
  // Claimed by buses this spec is NOT replacing. Counting the ones it IS
  // replacing would make every re-apply rename `Axis1` to `Axis1_01` and push
  // its channels to fresh addresses — the spec would never round-trip.
  const replaced = new Set(specs.map((device) => device.name))
  const untouched = openPLCStoreBase
    .getState()
    .project.data.remoteDevices?.filter((device) => !replaced.has(device.name))
  const usedAddresses = claimedAddresses(untouched)
  const takenNames = claimedSlaveNames(untouched)

  for (const device of withSlaves) {
    const slaves: ConfiguredEtherCATDevice[] = []
    for (const [position, spec] of (device.ethercat?.slaves ?? []).entries()) {
      const wanted = spec.esiDeviceRef.repositoryItemId
      const item = index.items.find((entry) => entry.id === wanted || entry.filename === wanted)
      if (!item) {
        errors.push(
          `EtherCAT slave on "${device.name}": no ESI file "${wanted}" in this project. ` +
            `Known files: ${index.items.map((entry) => entry.filename).join(', ') || '(none)'}.`,
        )
        continue
      }

      let xml = xmlCache.get(item.id)
      if (xml === undefined) {
        const loaded = await esi.loadXmlFile(projectPath, item.id)
        if (!loaded.success || !loaded.content) {
          errors.push(`EtherCAT slave on "${device.name}": could not read ${item.filename} — ${loaded.error ?? ''}`)
          continue
        }
        xml = loaded.content
        xmlCache.set(item.id, xml)
      }

      const built = normalizeEthercatSlave({
        spec: { ...spec, esiDeviceRef: { ...spec.esiDeviceRef, repositoryItemId: item.id } },
        xml,
        usedAddresses,
        takenNames,
        fallbackPosition: position,
        // Stable across runs, so re-applying the same spec does not rewrite the
        // file with new ids.
        id: `${device.name}-${position}`,
      })
      if (!built.ok) {
        errors.push(...built.errors)
        continue
      }
      slaves.push(built.value)
    }
    byDevice.set(device.name, slaves)
  }

  return byDevice
}

/** IEC addresses held by the given devices. */
function claimedAddresses(devices: readonly PLCRemoteDevice[] | undefined): Set<string> {
  const claimed = new Set<string>()
  for (const device of devices ?? []) {
    for (const slave of device.ethercatConfig?.devices ?? []) {
      for (const mapping of slave.channelMappings ?? []) claimed.add(mapping.iecLocation)
    }
  }
  return claimed
}

function claimedSlaveNames(devices: readonly PLCRemoteDevice[] | undefined): Set<string> {
  const names = new Set<string>()
  for (const device of devices ?? []) {
    for (const slave of device.ethercatConfig?.devices ?? []) names.add(slave.name)
  }
  return names
}

/** Remove servers and remote devices the spec stopped mentioning. */
export function pruneProtocols(spec: ApplySpec, changes: PlannedChange[]): void {
  const state = () => openPLCStoreBase.getState()

  if (spec.servers) {
    const wanted = new Set(spec.servers.map((server) => server.name))
    for (const server of [...(state().project.data.servers ?? [])]) {
      if (wanted.has(server.name)) continue
      state().projectActions.deleteServer(server.name)
      changes.push({ kind: 'server', action: 'delete', name: server.name })
    }
  }

  if (spec.remoteDevices) {
    const wanted = new Set(spec.remoteDevices.map((device) => device.name))
    for (const device of [...(state().project.data.remoteDevices ?? [])]) {
      if (wanted.has(device.name)) continue
      state().projectActions.deleteRemoteDevice(device.name)
      changes.push({ kind: 'remote-device', action: 'delete', name: device.name })
    }
  }
}
