/*
openplc_version.h - OpenPLC runtime/firmware version
Copyright (C) 2022 OpenPLC - Thiago Alves

Single source of truth for the firmware version reported by the always-on
debugger (Modbus FC 0x47, DEBUG_GET_VERSION). This is a property of the
firmware source tree, NOT the editor application version, so it is defined
here rather than injected by the editor at compile time. Bump manually when
the firmware runtime evolves.
*/

#ifndef OPENPLC_VERSION_H
#define OPENPLC_VERSION_H

#ifndef OPENPLC_RUNTIME_VERSION
    #define OPENPLC_RUNTIME_VERSION "4.2.7"
#endif

#endif // OPENPLC_VERSION_H
