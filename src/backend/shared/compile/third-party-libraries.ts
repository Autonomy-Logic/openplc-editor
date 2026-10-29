/**
 * Arduino libraries the editor installs from a git URL rather than from the
 * Arduino Library Manager index.
 *
 * arduino-cli's library index URL is hardcoded in the binary, so there is no way
 * to point it at a private registry: `board_manager.additional_urls` covers
 * platforms only. Installing by git URL is the alternative to publishing to the
 * public Arduino registry.
 *
 * Selection is by capability, never by board name. See
 * `selectThirdPartyLibraries`.
 */

import type { TargetCapabilities } from '../../../middleware/shared/utils/target-capabilities/types'

export interface ThirdPartyLibrary {
  /** `name` from the library's `library.properties`, which is what
   *  `arduino-cli lib list` reports and what the installed-library cache is
   *  keyed on. It must match exactly or the library looks perpetually missing. */
  name: string
  /** Clone URL. No ref: the default branch is what production uses. */
  gitUrl: string
  /** Shown in the compile log when the library is installed, so a user who sees
   *  an unfamiliar download knows what asked for it. */
  reason: string
}

/**
 * The OPC-UA stack, as a source Arduino library: a fork of open62541 whose
 * default branch carries an amalgamated `open62541.c` / `open62541.h` built with
 * `UA_ARCHITECTURE=none`. Source rather than precompiled, because prebuilt
 * archives only cover architectures someone thought to cross-compile for.
 */
export const OPEN62541_LIBRARY: ThirdPartyLibrary = {
  name: 'open62541',
  gitUrl: 'https://github.com/Autonomy-Logic/open62541-embedded.git',
  reason: 'OPC-UA server',
}

/**
 * The S7 protocol stack: a fork of Settimino, which was a client only. The fork
 * adds the server role as a transport-free protocol engine that owns no socket,
 * so the runtime plugs its own network seam behind it.
 *
 * Already a source Arduino library with `architectures=*`.
 */
export const SETTIMINO_LIBRARY: ThirdPartyLibrary = {
  name: 'Settimino',
  gitUrl: 'https://github.com/Autonomy-Logic/Settimino.git',
  reason: 'S7Comm server',
}

/** Everything installable this way. Small on purpose. */
export const THIRD_PARTY_LIBRARIES: ThirdPartyLibrary[] = [OPEN62541_LIBRARY, SETTIMINO_LIBRARY]

/**
 * Which of them this target needs. Capability-driven, so a board that will never
 * run an OPC-UA server never downloads the OPC-UA stack, and adding a target is
 * a manifest change rather than a code change here.
 */
export function selectThirdPartyLibraries(capabilities: TargetCapabilities | undefined): ThirdPartyLibrary[] {
  if (!capabilities) return []
  const selected: ThirdPartyLibrary[] = []
  if (capabilities.opcuaServer) selected.push(OPEN62541_LIBRARY)
  if (capabilities.s7Server) selected.push(SETTIMINO_LIBRARY)
  return selected
}
