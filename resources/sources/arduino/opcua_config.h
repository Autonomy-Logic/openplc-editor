// opcua_config.h — placeholder stub.
//
// The editor overwrites this file with the project's real OPC-UA
// configuration for any target whose VPP declares `opcuaServer: true`
// (see `generate-opcua-header.ts`).  It stays as-is on every other target.
//
// It exists so the OPC-UA translation units can `#include "opcua_config.h"`
// unconditionally: with OPCUA_ENABLED at 0 they compile to nothing, which
// keeps the server off the flash budget of boards that will never run it
// instead of guarding every include site.

#ifndef OPCUA_CONFIG_H
#define OPCUA_CONFIG_H

#define OPCUA_ENABLED 0

#endif // OPCUA_CONFIG_H
