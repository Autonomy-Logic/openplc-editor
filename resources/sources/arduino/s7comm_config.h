// s7comm_config.h — placeholder stub.
//
// The editor overwrites this file with the project's real S7Comm
// configuration for any target whose VPP declares `s7Server: true`
// (see `generate-s7comm-header.ts`).  It stays as-is on every other target.
//
// It exists so the S7Comm translation units can `#include "s7comm_config.h"`
// unconditionally: with S7COMM_ENABLED at 0 they compile to nothing, which
// keeps the server off the flash budget of boards that will never run it
// instead of guarding every include site.
//
// The property that has to hold, and that is tested: a project with no S7
// server configured must produce a byte-identical image to one built before
// this feature existed.

#ifndef S7COMM_CONFIG_H
#define S7COMM_CONFIG_H

#define S7COMM_ENABLED 0

#endif // S7COMM_CONFIG_H
