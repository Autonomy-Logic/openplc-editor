import type { BootloaderApiResult, BootloaderCapabilities } from '../../ports/runtime-port'

export type BootloaderDecision =
  | { kind: 'recovery'; state: string }
  | { kind: 'busy'; state: string }
  | { kind: 'check-ssh' }

const DISPLAYED_STATE_MAX_LENGTH = 64
const UNKNOWN_STATE = 'unknown'

function isControlCharacter(character: string): boolean {
  const code = character.charCodeAt(0)
  return code <= 0x1f || code === 0x7f
}

function displayedState(state: string): string {
  const printable = Array.from(state)
    .filter((character) => !isControlCharacter(character))
    .slice(0, DISPLAYED_STATE_MAX_LENGTH)
    .join('')
  return printable === '' ? UNKNOWN_STATE : printable
}

export function decideAfterBootloader(result: BootloaderApiResult<BootloaderCapabilities>): BootloaderDecision {
  if (!result.success) return { kind: 'check-ssh' }
  const { state, recovery } = result.data
  if (recovery || state === 'recovery') return { kind: 'recovery', state: displayedState(state) }
  if (state === 'healthy') return { kind: 'check-ssh' }
  return { kind: 'busy', state: displayedState(state) }
}
