import type { EsiPort } from '../../ports/esi-port'
import type { ESIModule } from '../../ports/esi-types'

/** True when two module idents (`0x…`, `#x…` or decimal) denote the same number. */
export function identsEqual(a: string, b: string): boolean {
  const toNumber = (v: string): number => {
    const t = v.trim()
    if (/^(0x|#x)/i.test(t)) return parseInt(t.slice(2), 16)
    return /^\d+$/.test(t) ? parseInt(t, 10) : Number.NaN
  }
  const na = toNumber(a)
  const nb = toNumber(b)
  return Number.isFinite(na) && na === nb
}

/** First module whose ident equals `ident` numerically. */
export function findModuleByIdent<T extends { ident: string }>(modules: readonly T[], ident: string): T | undefined {
  return modules.find((m) => identsEqual(m.ident, ident))
}

/**
 * Load a module's full definition from a repository item: modules carried inline by one
 * of the item's devices first, then a module-only file. Undefined when neither has it.
 */
export async function resolveEsiModule(
  esi: Pick<EsiPort, 'loadDeviceFull' | 'loadModuleFull'>,
  repoItem: { id: string; devices: readonly unknown[] },
  ident: string,
): Promise<ESIModule | undefined> {
  for (let i = 0; i < repoItem.devices.length; i++) {
    try {
      const r = await esi.loadDeviceFull(repoItem.id, i)
      const found = r.success ? findModuleByIdent(r.device.modules ?? [], ident) : undefined
      if (found !== undefined) return found
    } catch {
      // A device that fails to load cannot carry the module; try the next one.
    }
  }
  try {
    const r = await esi.loadModuleFull(repoItem.id, ident)
    return r.success ? r.module : undefined
  } catch {
    return undefined
  }
}
