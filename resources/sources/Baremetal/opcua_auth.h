/*
opcua_auth.h - username/password verification for the OPC-UA server
Copyright (C) 2026 Autonomy Logic

The editor hashes OPC-UA passwords with PBKDF2-HMAC-SHA256 and stores them as

    pbkdf2:sha256:<iterations>$<salt-b64>$<hash-b64>

which the generated OPCUA_USERS[] carries verbatim, so this runtime verifies
against exactly the string Runtime v4 does. Nothing here invents a format.

WHY THIS IS AWKWARD ON A MICROCONTROLLER

The iteration count is chosen for a Linux runtime (600,000, the OWASP figure),
and on a 120 MHz Cortex-M4 with no SHA-256 accelerator that is billions of
cycles. It cannot run inside a PLC scan.

The obvious fix -- chunk the KDF across scans and leave the session activation
pending -- does not survive contact with the library: open62541's
AccessControl::activateSession returns a UA_StatusCode synchronously and,
with multithreading disabled, has no deferral path. So the work is resumable
HERE (opcua_pbkdf2_step) and the policy question is how many iterations the
target is asked to do, not whether it can spread them out.

See the measured cost in opcua_auth.cpp and plan §4.4.
*/

#ifndef OPCUA_AUTH_H
#define OPCUA_AUTH_H

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <stdint.h>
#include <stddef.h>

#include <open62541.h>

/** Verify `password` against an editor-format hash string.
 *
 *  Returns true only on a match. Constant-time in the final comparison; the
 *  KDF itself is inherently timing-visible in its iteration count, which is
 *  public anyway (it is in the hash string). */
bool opcua_auth_verify(const char* password, size_t password_len,
                       const char* stored_hash);

/** Microseconds the last verification took, for the scan-impact census. */
uint32_t opcua_auth_last_us(void);

/** Role of `username`, or 0xFF when unknown. */
uint8_t opcua_auth_role_of(const char* username, size_t len);

/** Install username/password access control on `config`.
 *
 *  Anonymous access stays enabled when the project declares no users, so a
 *  project that never configured any is unaffected. With users declared,
 *  anonymous is refused -- declaring users and still accepting anonymous would
 *  make the users decorative. */
UA_StatusCode opcua_auth_install(UA_ServerConfig* config);

#endif // OPCUA_ENABLED
#endif // OPCUA_AUTH_H
