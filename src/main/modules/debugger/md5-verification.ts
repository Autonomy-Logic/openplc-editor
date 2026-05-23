import type { Md5VerifyResult } from '@root/middleware/shared/ports'

const RECOVERABLE_MD5_ERROR_MESSAGES = [
  'Failed to get MD5 hash after retries',
  'Function code mismatch',
  'Invalid response: too short',
  'Request timeout',
  'Target returned error code',
]

const TARGET_MD5_UNAVAILABLE_MESSAGE =
  'Target did not provide a program MD5. This usually means the device has not been flashed with an OpenPLC program yet.'

export function isRecoverableMd5ReadError(error: unknown): boolean {
  const messages = collectErrorMessages(error)

  return messages.some((message) =>
    RECOVERABLE_MD5_ERROR_MESSAGES.some((recoverableMessage) => message.includes(recoverableMessage)),
  )
}

export function createMd5UnavailableResult(): Md5VerifyResult {
  return {
    success: true,
    match: false,
    targetMd5Unavailable: true,
    error: TARGET_MD5_UNAVAILABLE_MESSAGE,
  }
}

function collectErrorMessages(error: unknown): string[] {
  const messages: string[] = []
  const visited = new Set<unknown>()
  let current: unknown = error

  while (current && !visited.has(current)) {
    visited.add(current)

    if (current instanceof Error) {
      messages.push(current.message)
      current = 'cause' in current ? current.cause : null
      continue
    }

    if (typeof current === 'string') {
      messages.push(current)
      break
    }

    if (
      typeof current === 'object' &&
      current !== null &&
      'message' in current &&
      typeof current.message === 'string'
    ) {
      messages.push(current.message)
    }

    break
  }

  return messages
}
