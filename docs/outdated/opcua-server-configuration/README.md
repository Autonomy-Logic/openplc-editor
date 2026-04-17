# OPC-UA Server Configuration

This folder contains design documentation for the OPC-UA server configuration feature in OpenPLC Editor.

## Overview

The OPC-UA server configuration allows users to configure an OPC-UA server that runs on the OpenPLC Runtime. This feature enables industrial clients to access PLC variables through the OPC-UA protocol, which is significantly more complex than the existing Modbus and S7Comm protocols.

## Key Features

- **Full Variable Access**: Unlike Modbus/S7Comm which only access I/O image tables, OPC-UA can expose any PLC program variable
- **Security Profiles**: Multiple security configurations (None, Sign, SignAndEncrypt)
- **Certificate Management**: Server and client certificate handling
- **User Authentication**: Password-based and certificate-based authentication
- **Role-Based Access Control**: Viewer, Operator, and Engineer roles with per-variable permissions
- **Complex Data Types**: Support for structures, arrays, and nested function blocks

## Documentation Structure

1. **[Design Overview](./01-design-overview.md)** - High-level architecture, configuration flow, and integration points
2. **[UI Screen Specifications](./02-ui-screen-specifications.md)** - Detailed UI designs for each configuration tab
3. **[JSON Configuration Mapping](./03-json-configuration-mapping.md)** - How editor configuration maps to runtime JSON format
4. **[Implementation Phases](./04-implementation-phases.md)** - Phased implementation plan with deliverables

## Related Documentation

- OpenPLC Runtime OPC-UA Plugin: See the `RTOP-100-OPC-UA` branch of openplc-runtime
- Existing protocol implementations: Modbus and S7Comm configurations in openplc-editor

## Key Differences from Modbus/S7Comm

| Aspect | Modbus/S7Comm | OPC-UA |
|--------|---------------|--------|
| Variable Access | I/O Image Tables only | Any PLC variable |
| Security | Basic or none | Multiple security profiles |
| Authentication | None | Anonymous, Username/Password, Certificate |
| Access Control | None | Role-based per-variable permissions |
| Data Types | Simple registers/coils | Variables, Structures, Arrays |
| Configuration Complexity | Low-Medium | High |
