/** The marker Electron places right before its fuse wire (`@electron/fuses`). */
export const FUSE_SENTINEL = Buffer.from('dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX', 'latin1')

/** The only fuse wire version this reader understands. */
export const FUSE_WIRE_VERSION = 1

/** Fuse states as stored on the wire. */
export const FUSE_STATE = Object.freeze({ disabled: 0x30, enabled: 0x31, removed: 0x72 })

/** The fuses a release build must carry: wire index and the state it must hold. */
export const HARDENED_FUSES = Object.freeze([
  { name: 'RunAsNode', index: 0, state: FUSE_STATE.disabled },
  { name: 'EnableNodeOptionsEnvironmentVariable', index: 2, state: FUSE_STATE.disabled },
  { name: 'EnableNodeCliInspectArguments', index: 3, state: FUSE_STATE.disabled },
  { name: 'EnableEmbeddedAsarIntegrityValidation', index: 4, state: FUSE_STATE.enabled },
  { name: 'OnlyLoadAppFromAsar', index: 5, state: FUSE_STATE.enabled },
])

/**
 * Every fuse wire in an Electron binary; a universal macOS binary holds one per slice.
 * @param {Buffer} binary
 * @returns {{ offset: number, version: number | undefined, states: number[] }[]}
 */
export function readFuseWires(binary) {
  const wires = []
  for (let at = binary.indexOf(FUSE_SENTINEL); at !== -1; at = binary.indexOf(FUSE_SENTINEL, at + 1)) {
    const start = at + FUSE_SENTINEL.length
    const length = start + 1 < binary.length ? binary[start + 1] : 0
    const states = [...binary.subarray(start + 2, Math.min(start + 2 + length, binary.length))]
    wires.push({ offset: at, version: binary[start], states })
  }
  return wires
}

/**
 * Names a fuse state byte.
 * @param {number} state
 * @returns {string}
 */
export function fuseStateName(state) {
  const name = Object.keys(FUSE_STATE).find((key) => FUSE_STATE[key] === state)
  return name ?? `0x${state.toString(16).padStart(2, '0')}`
}

/**
 * The differences between the fuse wires of a binary and the hardened fuses; empty when every wire carries them.
 * @param {{ offset: number, version: number | undefined, states: number[] }[]} wires
 * @returns {string[]}
 */
export function hardenedFuseProblems(wires) {
  if (wires.length === 0) return ['no Electron fuse wire found']
  const problems = []
  for (const wire of wires) {
    const where = `fuse wire at offset ${wire.offset}`
    if (wire.version !== FUSE_WIRE_VERSION) {
      problems.push(`${where}: wire version ${wire.version ?? 'missing'}, expected ${FUSE_WIRE_VERSION}`)
      continue
    }
    for (const fuse of HARDENED_FUSES) {
      const state = wire.states[fuse.index]
      if (state === undefined) problems.push(`${where}: ${fuse.name} is not on the wire`)
      else if (state !== fuse.state) {
        problems.push(`${where}: ${fuse.name} is ${fuseStateName(state)}, expected ${fuseStateName(fuse.state)}`)
      }
    }
  }
  return problems
}
