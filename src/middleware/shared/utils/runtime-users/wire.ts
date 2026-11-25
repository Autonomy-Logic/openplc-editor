import type { RuntimeUser, RuntimeUserRole, UpdateUserParams } from '../../ports/runtime-port'
import { readRuntimeRole } from './roles'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** An account as the runtime reports it (`whoami`, a row of `get-users-info`), or null when it is not one. */
export function parseRuntimeUser(raw: unknown): RuntimeUser | null {
  if (!isRecord(raw)) return null
  const { id, username } = raw
  const role = readRuntimeRole(raw.role)
  if (typeof id !== 'number' || typeof username !== 'string' || role === null) return null
  return { id, username, role }
}

/** The accounts of a `get-users-info` reply. Anything that is not a list, such as `{"msg": "Users found"}`, is none. */
export function parseRuntimeUserList(raw: unknown): RuntimeUser[] {
  if (!Array.isArray(raw)) return []
  const users: RuntimeUser[] = []
  for (const entry of raw) {
    const user = parseRuntimeUser(entry)
    if (user) users.push(user)
  }
  return users
}

/** Parses a JSON response text, or null when it is not JSON. */
export function parseRuntimeJson(text: string): unknown {
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed
  } catch {
    return null
  }
}

/** The body of `PUT /api/update-user/<id>`: only the fields given, `currentPassword` as `current_password`. */
export function runtimeUpdateUserBody(params: UpdateUserParams): Record<string, string> {
  const body: Record<string, string> = {}
  if (params.username !== undefined) body.username = params.username
  if (params.password !== undefined) body.password = params.password
  if (params.currentPassword !== undefined) body.current_password = params.currentPassword
  if (params.role !== undefined) body.role = params.role
  return body
}

/** Runtime refusals that get a hint on what to do, by the runtime's message. */
const REFUSAL_HINTS: Readonly<Record<string, string>> = {
  'Cannot demote the last remaining admin': 'Make another account an admin first.',
}

function withHint(message: string): string {
  const hint = REFUSAL_HINTS[message]
  return hint ? `${message}. ${hint}` : message
}

/** The runtime's own message in an error that carries its reply body (`{"msg": ...}` or a JSON string), else the error. */
export function runtimeUserErrorMessage(error: string | undefined, fallback: string): string {
  if (!error) return fallback
  const parsed = parseRuntimeJson(error)
  if (typeof parsed === 'string' && parsed !== '') return withHint(parsed)
  if (isRecord(parsed)) {
    const message = parsed.msg ?? parsed.error
    if (typeof message === 'string' && message !== '') return withHint(message)
  }
  return withHint(error)
}

/** The runtime's refusal of an endpoint to the caller's role, which names neither the role nor the action. */
const ROLE_REFUSAL = "This account's role may not use this endpoint"

/** An account action the runtime may refuse. */
export type RuntimeUserAction = 'list' | 'create' | 'update' | 'rename' | 'delete'

const ROLE_REFUSAL_TEXT: Readonly<Record<RuntimeUserAction, (role: string) => string>> = {
  list: (role) => `The account list is not available to your role (${role})`,
  create: (role) => `Your role (${role}) can't create accounts`,
  update: (role) => `Your role (${role}) can't change this account`,
  rename: (role) => `Your role (${role}) can't rename accounts`,
  delete: (role) => `Your role (${role}) can't delete accounts`,
}

const ACTION_FALLBACK: Readonly<Record<RuntimeUserAction, string>> = {
  list: 'Failed to load users',
  create: 'Failed to create user',
  update: 'Failed to update user',
  rename: 'Failed to update user',
  delete: 'Failed to delete user',
}

/**
 * What to tell the user when the runtime refused an account action: the runtime's own message, with the generic
 * role refusal rewritten to name the action and the signed-in role.
 */
export function runtimeUserRefusal(
  action: RuntimeUserAction,
  error: string | undefined,
  role: RuntimeUserRole | null | undefined,
): string {
  const message = runtimeUserErrorMessage(error, ACTION_FALLBACK[action])
  if (message !== ROLE_REFUSAL) return message
  return ROLE_REFUSAL_TEXT[action](role ?? 'unknown')
}
