/**
 * Finding OpenPLC Runtime v4 targets on the local network.
 *
 * A runtime (bare v4, or v4 behind a VPP package) answers a UDP broadcast on
 * port 33333 with a small JSON advertisement. This is the mechanism behind the
 * editor's "Search" button, extracted here so the GUI and the headless CLI run
 * the SAME scan: a second implementation would drift on the details that
 * actually decide whether a device is found — which interfaces get probed, how
 * long the window is, and how replies are deduplicated.
 *
 * Two details worth keeping:
 *
 *   - Every non-internal IPv4 interface is broadcast to individually, not just
 *     255.255.255.255. A host with several interfaces (docker bridges, a second
 *     NIC, a VPN) does not reliably deliver the global broadcast to the subnet
 *     the PLC is actually on.
 *   - A per-target send failure is logged and ignored rather than aborting.
 *     VPN tun adapters routinely refuse broadcast, and treating that as fatal
 *     would make a scan fail purely because a VPN was connected.
 */

import dgram from 'node:dgram'
import { networkInterfaces } from 'node:os'

import { RUNTIME_API_PORT } from '@root/backend/editor/runtime/runtime-api-client'

export const DISCOVERY_PORT = 33333
export const DISCOVERY_MAGIC = 'OPENPLC_DISCOVER_V1'
export const DISCOVERY_DEFAULT_DURATION_MS = 3000
const DISCOVERY_MIN_DURATION_MS = 500
const DISCOVERY_MAX_DURATION_MS = 10000

export interface DiscoveredRuntime {
  ipAddress: string
  hostname: string
  runtimeVersion: string
  apiPort: number
  /** Name of the source project the device stores, when it has one.
   *
   *  Display only. It is whatever the uploading client said -- the device never
   *  opens the archive to check -- and it rides an unauthenticated broadcast,
   *  so nothing may depend on it being true. It exists so the retrieve picker
   *  can be populated without logging in to every device on the network; the
   *  authoritative name comes from the archive once retrieved. */
  projectName?: string
  /** When that project was stored, ISO 8601. Absent alongside `projectName`. */
  projectTimestamp?: string
}

export interface DiscoverRuntimesOptions {
  durationMs?: number
  /** Called as each device replies, so a UI can append rows before the window closes. */
  onDevice?: (device: DiscoveredRuntime) => void
  /** Diagnostic sink for per-interface send failures. */
  onDiagnostic?: (message: string) => void
}

export type DiscoverRuntimesResult = { success: true; devices: DiscoveredRuntime[] } | { success: false; error: string }

/**
 * The directed broadcast address for an IPv4 interface, derived from its
 * address and netmask: host bits set to 1, so `192.168.1.5/255.255.255.0`
 * becomes `192.168.1.255`.
 *
 * Falls back to the global broadcast for a /32 or otherwise degenerate mask,
 * where no meaningful directed broadcast exists — better to send somewhere
 * than to drop the interface silently.
 */
export function computeBroadcastAddress(address: string, netmask: string): string {
  const toOctets = (value: string): number[] | null => {
    const parts = value.split('.').map((part) => Number(part))
    if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null
    return parts
  }
  const addressOctets = toOctets(address)
  const maskOctets = toOctets(netmask)
  if (!addressOctets || !maskOctets) return '255.255.255.255'
  return addressOctets.map((octet, i) => (octet & maskOctets[i]) | (~maskOctets[i] & 0xff)).join('.')
}

/** Every address worth broadcasting to: the global one plus each interface's. */
export function broadcastTargets(interfaces = networkInterfaces()): string[] {
  const targets = new Set<string>(['255.255.255.255'])
  for (const list of Object.values(interfaces)) {
    if (!list) continue
    for (const info of list) {
      if (info.family !== 'IPv4' || info.internal) continue
      targets.add(computeBroadcastAddress(info.address, info.netmask))
    }
  }
  return [...targets]
}

/**
 * Parse one advertisement. Returns undefined for anything that is not an
 * OpenPLC runtime reply — the port is a broadcast port and other things on the
 * network do send to it.
 */
export function parseAdvertisement(payload: string, sourceAddress: string): DiscoveredRuntime | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    return undefined
  }
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record: Record<string, unknown> = { ...parsed }
  if (record.service !== 'openplc-runtime') return undefined
  return {
    ipAddress: sourceAddress,
    hostname: typeof record.hostname === 'string' ? record.hostname : '',
    runtimeVersion: typeof record.runtime_version === 'string' ? record.runtime_version : '',
    apiPort: typeof record.api_port === 'number' ? record.api_port : RUNTIME_API_PORT,
    // Absent keys mean the device stores no project, so these stay undefined
    // rather than becoming empty strings -- the picker distinguishes "no
    // project" from "a project with no name".
    ...(typeof record.project_name === 'string' && record.project_name
      ? { projectName: record.project_name }
      : {}),
    ...(typeof record.project_timestamp === 'string' && record.project_timestamp
      ? { projectTimestamp: record.project_timestamp }
      : {}),
  }
}

export function clampDiscoveryDuration(durationMs: number | undefined): number {
  return Math.max(
    DISCOVERY_MIN_DURATION_MS,
    Math.min(DISCOVERY_MAX_DURATION_MS, durationMs ?? DISCOVERY_DEFAULT_DURATION_MS),
  )
}

/** Broadcast, collect replies for the window, and resolve with what answered. */
export function discoverRuntimes(options: DiscoverRuntimesOptions = {}): Promise<DiscoverRuntimesResult> {
  const duration = clampDiscoveryDuration(options.durationMs)

  return new Promise((resolveOuter) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true })
    // Dedup by source IP; last reply wins, so a runtime that changes its
    // hostname mid-scan settles on the fresh data.
    const discovered = new Map<string, DiscoveredRuntime>()
    let settled = false
    let timer: NodeJS.Timeout | null = null

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try {
        socket.close()
      } catch {
        /* already closed */
      }
      resolveOuter(
        error ? { success: false, error: error.message } : { success: true, devices: [...discovered.values()] },
      )
    }

    socket.on('error', (error) => finish(error))

    socket.on('message', (message, remote) => {
      const device = parseAdvertisement(message.toString('utf-8'), remote.address)
      if (!device) return
      discovered.set(device.ipAddress, device)
      options.onDevice?.(device)
    })

    socket.bind(0, () => {
      try {
        socket.setBroadcast(true)
      } catch (error) {
        finish(error as Error)
        return
      }

      const magic = new Uint8Array(Buffer.from(DISCOVERY_MAGIC, 'utf-8'))
      for (const target of broadcastTargets()) {
        socket.send(magic, DISCOVERY_PORT, target, (sendError) => {
          if (sendError) options.onDiagnostic?.(`Discovery send to ${target} failed: ${sendError.message}`)
        })
      }

      timer = setTimeout(() => finish(), duration)
    })
  })
}
