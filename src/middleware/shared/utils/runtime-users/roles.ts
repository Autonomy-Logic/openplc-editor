import { isVersionAtLeast } from '../../../../frontend/utils/semver'
import type { RuntimeUserRole, RuntimeWireRole } from '../../ports/runtime-port'

/** Oldest runtime with the four roles. Runtimes from 4.1.9 up to it have `admin` and `user`. */
export const MIN_FOUR_ROLE_RUNTIME_VERSION = '4.4.0'

/** The four roles, in the order the role picker lists them. */
export const RUNTIME_USER_ROLES: readonly RuntimeUserRole[] = ['admin', 'engineer', 'operator', 'viewer']

/** The roles a runtime before 4.4.0 can hold, as the editor names them. */
const LEGACY_RUNTIME_USER_ROLES: readonly RuntimeUserRole[] = ['admin', 'engineer']

/** Display name of each role. */
export const RUNTIME_ROLE_LABELS: Readonly<Record<RuntimeUserRole, string>> = {
  admin: 'Admin',
  engineer: 'Engineer',
  operator: 'Operator',
  viewer: 'Viewer',
}

/** One-line description of each role, shown in the role picker. */
export const RUNTIME_ROLE_DESCRIPTIONS: Readonly<Record<RuntimeUserRole, string>> = {
  admin: 'Manages accounts and does everything an engineer does.',
  engineer: 'Uploads programs, starts and stops the PLC, reads logs and debugs.',
  operator: 'Uses the HMI screens granted to operators; no program upload, debugging or account management.',
  viewer: 'Uses the HMI screens granted to viewers; no program upload, debugging or account management.',
}

/** Role of a new account. */
export const DEFAULT_NEW_ACCOUNT_ROLE: RuntimeUserRole = 'engineer'

/** Whether the runtime has the four roles (>= 4.4.0). An unknown version answers false. */
export function isFourRoleRuntime(runtimeVersion: string | null | undefined): boolean {
  return isVersionAtLeast(runtimeVersion, MIN_FOUR_ROLE_RUNTIME_VERSION)
}

/** The role a runtime reports, as the editor names it: `user` reads as `engineer`; anything unknown is null. */
export function readRuntimeRole(raw: unknown): RuntimeUserRole | null {
  switch (raw) {
    case 'admin':
    case 'engineer':
    case 'operator':
    case 'viewer':
      return raw
    case 'user':
      return 'engineer'
    default:
      return null
  }
}

/** The role name to send to a runtime: an engineer is `user` on a runtime before 4.4.0. */
export function toRuntimeWireRole(role: RuntimeUserRole, runtimeVersion: string | null | undefined): RuntimeWireRole {
  if (role === 'engineer' && !isFourRoleRuntime(runtimeVersion)) return 'user'
  return role
}

/** The roles the picker offers for this runtime: all four, or Admin and Engineer before 4.4.0. */
export function assignableRuntimeRoles(runtimeVersion: string | null | undefined): readonly RuntimeUserRole[] {
  return isFourRoleRuntime(runtimeVersion) ? RUNTIME_USER_ROLES : LEGACY_RUNTIME_USER_ROLES
}

/** Whether the role is an HMI account (operator or viewer). */
export function isHmiRole(role: RuntimeUserRole | null | undefined): boolean {
  return role === 'operator' || role === 'viewer'
}

/** An engineering action that HMI accounts may not take. */
export type EngineeringAction = 'upload' | 'start-stop' | 'logs' | 'debugger'

const ENGINEERING_ACTION_TEXT: Readonly<Record<EngineeringAction, string>> = {
  upload: 'upload programs',
  'start-stop': 'start or stop the PLC',
  logs: 'read the runtime logs',
  debugger: 'use the debugger',
}

/** The notice for an engineering action the signed-in role may not take, or null when it may. */
export function engineeringActionRefusal(
  role: RuntimeUserRole | null | undefined,
  action: EngineeringAction,
): string | null {
  if (!role || !isHmiRole(role)) return null
  return `Your role (${role}) can't ${ENGINEERING_ACTION_TEXT[action]}`
}
