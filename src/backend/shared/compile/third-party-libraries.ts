/**
 * Arduino libraries the editor installs from a git URL rather than from the
 * Arduino Library Manager index.
 *
 * Why this exists at all: arduino-cli's library index URL is hardcoded in the
 * binary, so there is no way to point it at a private registry —
 * `board_manager.additional_urls` covers platforms only. The alternatives were
 * publishing to the public Arduino registry (and owning a public library's
 * maintenance and support), or installing by git URL. This is the latter.
 *
 * Selection is by CAPABILITY, never by board name: a target gets a library
 * because it declares the feature that needs it. See `selectThirdPartyLibraries`.
 */

import type { TargetCapabilities } from '../../../middleware/shared/utils/target-capabilities/types'

export interface ThirdPartyLibrary {
  /** `name` from the library's `library.properties` — this is what
   *  `arduino-cli lib list` reports and what the installed-library cache is
   *  keyed on, so it must match exactly or the library looks perpetually
   *  missing and is reinstalled on every build. */
  name: string
  /** Clone URL. No ref: the default branch is what production uses, so a
   *  push to it is a release. */
  gitUrl: string
  /** Shown in the compile log when the library is installed, so a user who
   *  sees an unfamiliar download knows what asked for it. */
  reason: string
}

/**
 * The OPC-UA stack, as a source Arduino library.
 *
 * A fork of open62541 whose default branch carries an amalgamated
 * `open62541.c` / `open62541.h` built with `UA_ARCHITECTURE=none`. Source
 * rather than precompiled deliberately: prebuilt archives only ever cover
 * architectures someone thought to cross-compile for, and the whole point of
 * moving this out of the LOGO! core was that it existed for exactly one board.
 */
export const OPEN62541_LIBRARY: ThirdPartyLibrary = {
  name: 'open62541',
  gitUrl: 'https://github.com/Autonomy-Logic/open62541-embedded.git',
  reason: 'OPC-UA server',
}

/** Everything installable this way. Small on purpose. */
export const THIRD_PARTY_LIBRARIES: ThirdPartyLibrary[] = [OPEN62541_LIBRARY]

/**
 * Which of them this target needs.
 *
 * Capability-driven so a board that will never run an OPC-UA server never
 * downloads 7 MB of OPC-UA stack — and so adding a target is a manifest
 * change rather than a code change here.
 */
export function selectThirdPartyLibraries(capabilities: TargetCapabilities | undefined): ThirdPartyLibrary[] {
  if (!capabilities) return []
  const selected: ThirdPartyLibrary[] = []
  if (capabilities.opcuaServer) selected.push(OPEN62541_LIBRARY)
  return selected
}
