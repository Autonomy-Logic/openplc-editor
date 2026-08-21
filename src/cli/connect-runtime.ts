/**
 * Getting an authenticated runtime session, for every command that needs one.
 *
 * One place, because there are two ways in and both commands need both. The
 * ordinary way is a login. The other is a runtime that has **no user account at
 * all** — a fresh install answers `/api/get-users-info` with 404, and until
 * someone is created there is nothing to log in as.
 *
 * The editor handles that with a create-user screen. A CLI cannot prompt, so it
 * asks up front: `--create-user` says "bootstrap the first account with the
 * credentials I gave you". Without it, an empty runtime fails with a message
 * naming the flag rather than an authentication error that looks like a typo'd
 * password.
 *
 * Creating an account is not something to do implicitly. The first user on an
 * OpenPLC runtime is an admin, and it is the credential that governs the device
 * from then on — so it takes an explicit request, every time.
 */

import { RuntimeApiClient } from '@root/backend/editor/runtime/runtime-api-client'

import { boolFlag, type ParsedArgs } from './args'
import { resolveRuntimeCredentials } from './credentials'
import { ErrorCode, type ErrorCodeValue, ExitCode, type ExitCodeValue } from './exit-codes'

export interface ConnectRuntimeResult {
  runtime: RuntimeApiClient
  /** True when this call created the runtime's first account. */
  createdUser: boolean
}

export interface ConnectRuntimeFailure {
  code: ErrorCodeValue
  message: string
  exitCode: ExitCodeValue
}

export interface ConnectRuntimeOptions {
  host: string
  args: ParsedArgs
  /** Supplied by an in-process caller that already holds them. */
  credentials?: { username: string; password: string }
  onProgress: (message: string) => void
}

export async function connectToRuntime(
  options: ConnectRuntimeOptions,
): Promise<{ ok: true; value: ConnectRuntimeResult } | { ok: false; failure: ConnectRuntimeFailure }> {
  const credentials = options.credentials ?? resolveRuntimeCredentials(options.args)
  if ('error' in credentials) {
    return {
      ok: false,
      failure: { code: ErrorCode.MissingArgument, message: credentials.error, exitCode: ExitCode.Usage },
    }
  }

  const runtime = new RuntimeApiClient()

  // Ask before authenticating: on a fresh runtime there is nothing to
  // authenticate against, and a plain login there fails in a way that reads
  // like wrong credentials.
  const users = await runtime.getUsersInfo(options.host)
  if (users.error && !users.hasUsers) {
    return {
      ok: false,
      failure: {
        code: ErrorCode.NotConnected,
        message: `Could not reach the runtime at ${options.host}: ${users.error}`,
        exitCode: ExitCode.Connection,
      },
    }
  }

  let createdUser = false
  if (!users.hasUsers) {
    if (!boolFlag(options.args, 'create-user')) {
      return {
        ok: false,
        failure: {
          code: ErrorCode.AuthRequired,
          message:
            `The runtime at ${options.host} has no user account yet, so there is nothing to log in as. ` +
            'Re-run with --create-user to create the first account (an admin) from the credentials you passed, ' +
            'or create it in the editor first.',
          exitCode: ExitCode.Auth,
        },
      }
    }

    options.onProgress(`No user on ${options.host}; creating the first account "${credentials.username}"…`)
    const created = await runtime.createUser(options.host, credentials.username, credentials.password)
    if (!created.success) {
      return {
        ok: false,
        failure: {
          code: ErrorCode.AuthRejected,
          message: `Could not create the first user on ${options.host}: ${created.error ?? 'unknown error'}`,
          exitCode: ExitCode.Auth,
        },
      }
    }
    createdUser = true
  }

  options.onProgress(`Authenticating with ${options.host}…`)
  const login = await runtime.login(options.host, credentials.username, credentials.password)
  if (!login.success) {
    return {
      ok: false,
      failure: {
        code: ErrorCode.AuthRejected,
        message: login.error ?? 'The runtime rejected the credentials',
        exitCode: ExitCode.Auth,
      },
    }
  }

  return { ok: true, value: { runtime, createdUser } }
}
