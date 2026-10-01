/*
opcua_auth.h - username/password verification for the OPC-UA server
Copyright (C) 2026 Autonomy Logic

The editor stores OPC-UA passwords as
`pbkdf2:sha256:<iterations>$<salt-b64>$<hash-b64>`, which the generated
OPCUA_USERS[] carries verbatim.

The iteration count is chosen for a Linux runtime and cannot run inside a PLC
scan on a part with no SHA-256 accelerator. Chunking across scans does not help,
because open62541's AccessControl::activateSession returns synchronously with no
deferral path, so the policy question is how many iterations to ask for.
*/

#ifndef OPCUA_AUTH_H
#define OPCUA_AUTH_H

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <stdint.h>
#include <stddef.h>

#include <open62541.h>

/** Verify `password` against an editor-format hash string. Returns true only on
 *  a match. Constant-time in the final comparison; the KDF's iteration count is
 *  public anyway. */
bool opcua_auth_verify(const char* password, size_t password_len,
                       const char* stored_hash);

/** Microseconds the last verification took, for the scan-impact census. */
uint32_t opcua_auth_last_us(void);

/** Role of `username`, or 0xFF when unknown. */
uint8_t opcua_auth_role_of(const char* username, size_t len);

/** Install username/password access control on `config`.
 *
 *  Anonymous access stays enabled when the project declares no users. With users
 *  declared, anonymous is refused. */
UA_StatusCode opcua_auth_install(UA_ServerConfig* config);

#endif // OPCUA_ENABLED
#endif // OPCUA_AUTH_H
