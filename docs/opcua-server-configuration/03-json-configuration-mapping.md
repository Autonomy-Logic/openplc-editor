# OPC-UA Server Configuration - JSON Configuration Mapping

This document describes how the editor configuration maps to the runtime JSON format expected by the OPC-UA plugin.

## 1. Overview

The OPC-UA configuration undergoes transformation during compilation:

```
┌─────────────────────────┐     ┌─────────────────────────┐
│   Editor Format         │     │   Runtime Format        │
│   (Project File)        │ ──► │   (opcua.json)          │
├─────────────────────────┤     ├─────────────────────────┤
│ • camelCase properties  │     │ • snake_case properties │
│ • Variable references   │     │ • Resolved indices      │
│ • No indices            │     │ • Full variable info    │
│ • TypeScript types      │     │ • JSON structure        │
└─────────────────────────┘     └─────────────────────────┘
```

## 2. Editor Data Model (Stored in Project)

### 2.1 Complete Type Definitions

```typescript
// ═══════════════════════════════════════════════════════════════════════
// Security Profile
// ═══════════════════════════════════════════════════════════════════════

interface OpcUaSecurityProfile {
  id: string                    // UUID
  name: string                  // Profile identifier (e.g., "insecure", "signed")
  enabled: boolean
  securityPolicy: 'None' | 'Basic128Rsa15' | 'Basic256' | 'Basic256Sha256'
  securityMode: 'None' | 'Sign' | 'SignAndEncrypt'
  authMethods: ('Anonymous' | 'Username' | 'Certificate')[]
}

// ═══════════════════════════════════════════════════════════════════════
// Trusted Certificate
// ═══════════════════════════════════════════════════════════════════════

interface OpcUaTrustedCertificate {
  id: string                    // Certificate identifier (referenced by users)
  pem: string                   // PEM-encoded certificate content
  // Derived fields for display (parsed from PEM)
  subject?: string
  validFrom?: string
  validTo?: string
  fingerprint?: string
}

// ═══════════════════════════════════════════════════════════════════════
// User Account
// ═══════════════════════════════════════════════════════════════════════

interface OpcUaUser {
  id: string                    // UUID
  type: 'password' | 'certificate'
  // For password auth
  username: string | null
  passwordHash: string | null   // bcrypt hash (never plain text)
  // For certificate auth
  certificateId: string | null  // References trustedCertificate.id
  // Common
  role: 'viewer' | 'operator' | 'engineer'
}

// ═══════════════════════════════════════════════════════════════════════
// Permissions
// ═══════════════════════════════════════════════════════════════════════

interface OpcUaPermissions {
  viewer: 'r' | 'w' | 'rw'
  operator: 'r' | 'w' | 'rw'
  engineer: 'r' | 'w' | 'rw'
}

// ═══════════════════════════════════════════════════════════════════════
// Address Space Node (Variable/Structure/Array)
// ═══════════════════════════════════════════════════════════════════════

interface OpcUaNodeConfig {
  id: string                    // UUID for tracking

  // PLC variable reference (resolved to index at compile time)
  pouName: string               // "main", "GVL", "FB_Motor"
  variablePath: string          // "MOTOR_SPEED", "CTRL.PID.OUTPUT"
  variableType: string          // IEC type

  // OPC-UA configuration
  nodeId: string                // OPC-UA node identifier
  browseName: string
  displayName: string
  description: string
  initialValue: boolean | number | string
  permissions: OpcUaPermissions

  // Type classification
  nodeType: 'variable' | 'structure' | 'array'

  // For structures: nested field configurations
  fields?: OpcUaFieldConfig[]

  // For arrays: element count (derived from type)
  arrayLength?: number
  elementType?: string
}

interface OpcUaFieldConfig {
  fieldPath: string             // "temperature", "status.is_valid"
  displayName: string
  initialValue: boolean | number | string
  permissions: OpcUaPermissions
}

// ═══════════════════════════════════════════════════════════════════════
// Complete Server Configuration
// ═══════════════════════════════════════════════════════════════════════

interface OpcUaServerConfig {
  server: {
    enabled: boolean
    name: string
    applicationUri: string
    productUri: string
    bindAddress: string
    port: number
    endpointPath: string
  }

  securityProfiles: OpcUaSecurityProfile[]

  security: {
    serverCertificateStrategy: 'auto_self_signed' | 'custom'
    serverCertificateCustom: string | null
    serverPrivateKeyCustom: string | null
    trustedClientCertificates: OpcUaTrustedCertificate[]
  }

  users: OpcUaUser[]

  cycleTimeMs: number

  addressSpace: {
    namespaceUri: string
    nodes: OpcUaNodeConfig[]
  }
}
```

## 3. Runtime JSON Format (Generated)

### 3.1 Complete Structure

The runtime expects a JSON array containing plugin configurations:

```json
[
  {
    "name": "opcua_server",
    "protocol": "OPC-UA",
    "config": {
      "server": {
        "name": "string",
        "application_uri": "string",
        "product_uri": "string",
        "endpoint_url": "string",
        "security_profiles": [
          {
            "name": "string",
            "enabled": true,
            "security_policy": "string",
            "security_mode": "string",
            "auth_methods": ["string"]
          }
        ]
      },
      "security": {
        "server_certificate_strategy": "string",
        "server_certificate_custom": "string|null",
        "server_private_key_custom": "string|null",
        "trusted_client_certificates": [
          {
            "id": "string",
            "pem": "string"
          }
        ]
      },
      "users": [
        {
          "type": "string",
          "username": "string|null",
          "password_hash": "string|null",
          "certificate_id": "string|null",
          "role": "string"
        }
      ],
      "cycle_time_ms": 100,
      "address_space": {
        "namespace_uri": "string",
        "variables": [...],
        "structures": [...],
        "arrays": [...]
      }
    }
  }
]
```

### 3.2 Address Space Variable Format

```json
{
  "node_id": "PLC.Main.MotorSpeed",
  "browse_name": "MotorSpeed",
  "display_name": "Motor Speed",
  "datatype": "INT",
  "initial_value": 0,
  "description": "Current motor speed in RPM",
  "index": 5,
  "permissions": {
    "viewer": "r",
    "operator": "rw",
    "engineer": "rw"
  }
}
```

### 3.3 Address Space Structure Format

```json
{
  "node_id": "PLC.Main.Sensor",
  "browse_name": "Sensor",
  "display_name": "Sensor Data",
  "description": "Main sensor data structure",
  "fields": [
    {
      "name": "temperature",
      "datatype": "REAL",
      "initial_value": 0.0,
      "index": 10,
      "permissions": {
        "viewer": "r",
        "operator": "r",
        "engineer": "rw"
      }
    },
    {
      "name": "pressure",
      "datatype": "REAL",
      "initial_value": 0.0,
      "index": 11,
      "permissions": {
        "viewer": "r",
        "operator": "r",
        "engineer": "rw"
      }
    },
    {
      "name": "status.is_valid",
      "datatype": "BOOL",
      "initial_value": false,
      "index": 12,
      "permissions": {
        "viewer": "r",
        "operator": "r",
        "engineer": "r"
      }
    }
  ]
}
```

### 3.4 Address Space Array Format

```json
{
  "node_id": "PLC.Main.Temperatures",
  "browse_name": "Temperatures",
  "display_name": "Temperature Readings",
  "datatype": "REAL",
  "length": 10,
  "initial_value": 0.0,
  "index": 20,
  "permissions": {
    "viewer": "r",
    "operator": "rw",
    "engineer": "rw"
  }
}
```

## 4. Field Mapping Reference

### 4.1 Server Settings

| Editor Field | Runtime JSON Field | Transformation |
|--------------|-------------------|----------------|
| server.enabled | (not in JSON) | Only generate JSON if enabled |
| server.name | config.server.name | Direct copy |
| server.applicationUri | config.server.application_uri | camelCase → snake_case |
| server.productUri | config.server.product_uri | camelCase → snake_case |
| server.bindAddress | config.server.endpoint_url | Combined into URL |
| server.port | config.server.endpoint_url | Combined into URL |
| server.endpointPath | config.server.endpoint_url | Combined into URL |

**Endpoint URL Construction:**
```typescript
const endpointUrl = `opc.tcp://${bindAddress}:${port}${endpointPath}`
// Example: opc.tcp://0.0.0.0:4840/openplc/opcua
```

### 4.2 Security Profiles

| Editor Field | Runtime JSON Field | Transformation |
|--------------|-------------------|----------------|
| securityProfile.name | security_profiles[].name | Direct copy |
| securityProfile.enabled | security_profiles[].enabled | Direct copy |
| securityProfile.securityPolicy | security_profiles[].security_policy | camelCase → snake_case |
| securityProfile.securityMode | security_profiles[].security_mode | camelCase → snake_case |
| securityProfile.authMethods | security_profiles[].auth_methods | camelCase → snake_case |

**Note:** Only enabled profiles are included in the output.

### 4.3 Security Settings

| Editor Field | Runtime JSON Field | Transformation |
|--------------|-------------------|----------------|
| security.serverCertificateStrategy | security.server_certificate_strategy | camelCase → snake_case |
| security.serverCertificateCustom | security.server_certificate_custom | camelCase → snake_case |
| security.serverPrivateKeyCustom | security.server_private_key_custom | camelCase → snake_case |
| security.trustedClientCertificates | security.trusted_client_certificates | Map to {id, pem} only |

### 4.4 Users

| Editor Field | Runtime JSON Field | Transformation |
|--------------|-------------------|----------------|
| user.type | users[].type | Direct copy |
| user.username | users[].username | Direct copy |
| user.passwordHash | users[].password_hash | camelCase → snake_case |
| user.certificateId | users[].certificate_id | camelCase → snake_case |
| user.role | users[].role | Direct copy |

### 4.5 Address Space Variables

| Editor Field | Runtime JSON Field | Transformation |
|--------------|-------------------|----------------|
| node.nodeId | variables[].node_id | camelCase → snake_case |
| node.browseName | variables[].browse_name | camelCase → snake_case |
| node.displayName | variables[].display_name | camelCase → snake_case |
| node.variableType | variables[].datatype | Renamed |
| node.initialValue | variables[].initial_value | camelCase → snake_case |
| node.description | variables[].description | Direct copy |
| (resolved) | variables[].index | **Resolved from debug.c** |
| node.permissions | variables[].permissions | Direct copy |

## 5. Index Resolution Process

### 5.1 Overview

Variable indices are resolved during compilation by matching the editor's variable references to entries in the generated `debug.c` file.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Index Resolution Flow                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Editor Config                 debug.c                 Runtime JSON     │
│  ┌─────────────┐              ┌─────────────┐         ┌─────────────┐  │
│  │ pouName:    │              │ debug_vars[]│         │ index: 5    │  │
│  │   "main"    │    Match     │ = {         │  Copy   │ datatype:   │  │
│  │ variablePath│ ──────────►  │   [5] VAR   │ ──────► │   "INT"     │  │
│  │   "SPEED"   │              │   ...       │         │             │  │
│  └─────────────┘              └─────────────┘         └─────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Path Building Rules

Different variable types require different debug path formats:

#### Simple Variables (Program/FB Instance)

```typescript
// Editor: pouName="main", variablePath="MOTOR_SPEED"
// Debug path: RES0__INSTANCE0.MOTOR_SPEED
const buildSimplePath = (pouName: string, varPath: string): string => {
  return `RES0__INSTANCE0.${varPath.toUpperCase()}`
}
```

#### Global Variables

```typescript
// Editor: pouName="GVL", variablePath="SYSTEM_STATE"
// Debug path: CONFIG0__SYSTEM_STATE
const buildGlobalPath = (varPath: string): string => {
  return `CONFIG0__${varPath.toUpperCase()}`
}
```

#### Structure Fields

```typescript
// Editor: pouName="main", variablePath="SENSOR.temperature"
// Debug path: RES0__INSTANCE0.SENSOR.value.TEMPERATURE
const buildStructFieldPath = (pouName: string, varPath: string): string => {
  const parts = varPath.split('.')
  const structVar = parts[0]
  const fieldPath = parts.slice(1).join('.value.')
  return `RES0__INSTANCE0.${structVar.toUpperCase()}.value.${fieldPath.toUpperCase()}`
}
```

#### Nested Structure Fields

```typescript
// Editor: pouName="main", variablePath="SENSOR.status.is_valid"
// Debug path: RES0__INSTANCE0.SENSOR.value.STATUS.value.IS_VALID
const buildNestedStructPath = (pouName: string, varPath: string): string => {
  const parts = varPath.split('.')
  let path = `RES0__INSTANCE0.${parts[0].toUpperCase()}`
  for (let i = 1; i < parts.length; i++) {
    path += `.value.${parts[i].toUpperCase()}`
  }
  return path
}
```

#### Function Block Variables

```typescript
// Editor: pouName="main", variablePath="TON0.ET"
// Debug path: RES0__INSTANCE0.TON0.ET
const buildFBVarPath = (pouName: string, varPath: string): string => {
  return `RES0__INSTANCE0.${varPath.toUpperCase()}`
}
```

#### Nested Function Block Variables

```typescript
// Editor: pouName="main", variablePath="MOTOR_CTRL.PID.OUTPUT"
// Debug path: RES0__INSTANCE0.MOTOR_CTRL.PID.OUTPUT
const buildNestedFBPath = (pouName: string, varPath: string): string => {
  return `RES0__INSTANCE0.${varPath.toUpperCase()}`
}
```

#### Array Elements

```typescript
// Editor: pouName="main", variablePath="TEMPS"
// Debug path for element [0]: RES0__INSTANCE0.TEMPS.value.table[0]
// Index is the starting index; elements are sequential
const buildArrayPath = (pouName: string, varPath: string, elementIndex: number): string => {
  return `RES0__INSTANCE0.${varPath.toUpperCase()}.value.table[${elementIndex}]`
}
```

### 5.3 Resolution Algorithm

```typescript
import { parseDebugFile, DebugVariable } from '@root/renderer/utils/parse-debug-file'

interface ResolvedVariable {
  nodeId: string
  browseName: string
  displayName: string
  datatype: string
  initialValue: any
  description: string
  index: number
  permissions: OpcUaPermissions
}

const resolveVariableIndex = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[]
): number => {
  // Build the expected debug path based on variable location
  let debugPath: string

  if (node.pouName === 'GVL' || node.pouName === 'CONFIG') {
    // Global variable
    debugPath = `CONFIG0__${node.variablePath.toUpperCase()}`
  } else {
    // Instance variable (program or FB)
    // Handle nested paths by checking for struct/array patterns
    debugPath = buildInstancePath(node.pouName, node.variablePath)
  }

  // Find matching entry in debug.c
  const match = debugVariables.find(
    dv => dv.name.toUpperCase() === debugPath.toUpperCase()
  )

  if (!match) {
    throw new Error(
      `Cannot resolve index for variable: ${node.pouName}:${node.variablePath}\n` +
      `Expected debug path: ${debugPath}`
    )
  }

  return match.index
}

const buildInstancePath = (pouName: string, variablePath: string): string => {
  // For struct fields, insert ".value." before each field access
  // For FB variables, use direct dot notation
  // This logic should match the debugger's path building

  const parts = variablePath.split('.')

  // Check if this involves struct fields (need .value. insertion)
  // This requires type information to determine correctly
  // For now, use the same logic as the debugger

  return `RES0__INSTANCE0.${variablePath.toUpperCase()}`
}
```

### 5.4 Structure Index Resolution

For structures, each field gets its own index:

```typescript
const resolveStructureIndices = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[]
): RuntimeStructure => {
  const fields = node.fields!.map(field => {
    const fieldPath = `${node.variablePath}.${field.fieldPath}`
    const debugPath = buildStructFieldDebugPath(node.pouName, fieldPath)

    const match = debugVariables.find(
      dv => dv.name.toUpperCase() === debugPath.toUpperCase()
    )

    if (!match) {
      throw new Error(`Cannot resolve index for field: ${fieldPath}`)
    }

    return {
      name: field.fieldPath,
      datatype: getFieldType(node.variableType, field.fieldPath),
      initial_value: field.initialValue,
      index: match.index,
      permissions: field.permissions,
    }
  })

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    description: node.description,
    fields,
  }
}
```

### 5.5 Array Index Resolution

For arrays, only the starting index is stored; elements are sequential:

```typescript
const resolveArrayIndex = (
  node: OpcUaNodeConfig,
  debugVariables: DebugVariable[]
): RuntimeArray => {
  // Find the first element's index
  const firstElementPath = buildArrayElementPath(
    node.pouName,
    node.variablePath,
    0  // First element (C-style index)
  )

  const match = debugVariables.find(
    dv => dv.name.toUpperCase() === firstElementPath.toUpperCase()
  )

  if (!match) {
    throw new Error(`Cannot resolve index for array: ${node.variablePath}`)
  }

  return {
    node_id: node.nodeId,
    browse_name: node.browseName,
    display_name: node.displayName,
    datatype: node.elementType!,
    length: node.arrayLength!,
    initial_value: node.initialValue,
    index: match.index,  // Starting index
    permissions: node.permissions,
  }
}
```

## 6. Complete Generator Implementation

```typescript
// src/utils/opcua/generate-opcua-config.ts

import { parseDebugFile, DebugVariable } from '@root/renderer/utils/parse-debug-file'
import type { PLCServer, OpcUaServerConfig, OpcUaNodeConfig } from '@root/types/PLC/open-plc'

interface RuntimeConfig {
  name: string
  protocol: 'OPC-UA'
  config: {
    server: RuntimeServerConfig
    security: RuntimeSecurityConfig
    users: RuntimeUser[]
    cycle_time_ms: number
    address_space: RuntimeAddressSpace
  }
}

export const generateOpcUaConfig = (
  servers: PLCServer[] | undefined,
  debugFileContent: string
): string | null => {
  // 1. Find OPC-UA server configuration
  if (!servers || servers.length === 0) return null

  const opcuaServer = servers.find(
    s => s.protocol === 'opcua' && s.opcuaServerConfig?.server.enabled
  )

  if (!opcuaServer?.opcuaServerConfig) return null

  const config = opcuaServer.opcuaServerConfig

  // 2. Parse debug.c to get variable indices
  const parsed = parseDebugFile(debugFileContent)
  const debugVariables = parsed.variables

  // 3. Build runtime configuration
  const runtimeConfig: RuntimeConfig = {
    name: 'opcua_server',
    protocol: 'OPC-UA',
    config: {
      server: buildServerConfig(config),
      security: buildSecurityConfig(config),
      users: buildUsersConfig(config),
      cycle_time_ms: config.cycleTimeMs,
      address_space: buildAddressSpace(config, debugVariables),
    },
  }

  // 4. Return as JSON string
  return JSON.stringify([runtimeConfig], null, 2)
}

const buildServerConfig = (config: OpcUaServerConfig): RuntimeServerConfig => {
  const { server, securityProfiles } = config

  return {
    name: server.name,
    application_uri: server.applicationUri,
    product_uri: server.productUri,
    endpoint_url: `opc.tcp://${server.bindAddress}:${server.port}${server.endpointPath}`,
    security_profiles: securityProfiles
      .filter(sp => sp.enabled)
      .map(sp => ({
        name: sp.name,
        enabled: sp.enabled,
        security_policy: sp.securityPolicy,
        security_mode: sp.securityMode,
        auth_methods: sp.authMethods,
      })),
  }
}

const buildSecurityConfig = (config: OpcUaServerConfig): RuntimeSecurityConfig => {
  const { security } = config

  return {
    server_certificate_strategy: security.serverCertificateStrategy,
    server_certificate_custom: security.serverCertificateCustom,
    server_private_key_custom: security.serverPrivateKeyCustom,
    trusted_client_certificates: security.trustedClientCertificates.map(cert => ({
      id: cert.id,
      pem: cert.pem,
    })),
  }
}

const buildUsersConfig = (config: OpcUaServerConfig): RuntimeUser[] => {
  return config.users.map(user => ({
    type: user.type,
    username: user.username,
    password_hash: user.passwordHash,
    certificate_id: user.certificateId,
    role: user.role,
  }))
}

const buildAddressSpace = (
  config: OpcUaServerConfig,
  debugVariables: DebugVariable[]
): RuntimeAddressSpace => {
  const variables: RuntimeVariable[] = []
  const structures: RuntimeStructure[] = []
  const arrays: RuntimeArray[] = []

  for (const node of config.addressSpace.nodes) {
    switch (node.nodeType) {
      case 'variable':
        variables.push(resolveVariable(node, debugVariables))
        break
      case 'structure':
        structures.push(resolveStructure(node, debugVariables))
        break
      case 'array':
        arrays.push(resolveArray(node, debugVariables))
        break
    }
  }

  return {
    namespace_uri: config.addressSpace.namespaceUri,
    variables,
    structures,
    arrays,
  }
}

// ... resolution functions as defined in section 5
```

## 7. Example Transformation

### 7.1 Editor Configuration (Stored in Project)

```json
{
  "server": {
    "enabled": true,
    "name": "OpenPLC OPC UA Server",
    "applicationUri": "urn:openplc:opcua:server",
    "productUri": "urn:openplc:runtime",
    "bindAddress": "0.0.0.0",
    "port": 4840,
    "endpointPath": "/openplc/opcua"
  },
  "securityProfiles": [
    {
      "id": "uuid-1",
      "name": "insecure",
      "enabled": true,
      "securityPolicy": "None",
      "securityMode": "None",
      "authMethods": ["Anonymous"]
    }
  ],
  "security": {
    "serverCertificateStrategy": "auto_self_signed",
    "serverCertificateCustom": null,
    "serverPrivateKeyCustom": null,
    "trustedClientCertificates": []
  },
  "users": [
    {
      "id": "uuid-2",
      "type": "password",
      "username": "engineer",
      "passwordHash": "$2b$12$...",
      "certificateId": null,
      "role": "engineer"
    }
  ],
  "cycleTimeMs": 100,
  "addressSpace": {
    "namespaceUri": "urn:openplc:opcua:namespace",
    "nodes": [
      {
        "id": "uuid-3",
        "pouName": "main",
        "variablePath": "MOTOR_SPEED",
        "variableType": "INT",
        "nodeId": "PLC.Main.MotorSpeed",
        "browseName": "MotorSpeed",
        "displayName": "Motor Speed",
        "description": "Current motor speed",
        "initialValue": 0,
        "permissions": {
          "viewer": "r",
          "operator": "rw",
          "engineer": "rw"
        },
        "nodeType": "variable"
      }
    ]
  }
}
```

### 7.2 Generated Runtime JSON (opcua.json)

```json
[
  {
    "name": "opcua_server",
    "protocol": "OPC-UA",
    "config": {
      "server": {
        "name": "OpenPLC OPC UA Server",
        "application_uri": "urn:openplc:opcua:server",
        "product_uri": "urn:openplc:runtime",
        "endpoint_url": "opc.tcp://0.0.0.0:4840/openplc/opcua",
        "security_profiles": [
          {
            "name": "insecure",
            "enabled": true,
            "security_policy": "None",
            "security_mode": "None",
            "auth_methods": ["Anonymous"]
          }
        ]
      },
      "security": {
        "server_certificate_strategy": "auto_self_signed",
        "server_certificate_custom": null,
        "server_private_key_custom": null,
        "trusted_client_certificates": []
      },
      "users": [
        {
          "type": "password",
          "username": "engineer",
          "password_hash": "$2b$12$...",
          "certificate_id": null,
          "role": "engineer"
        }
      ],
      "cycle_time_ms": 100,
      "address_space": {
        "namespace_uri": "urn:openplc:opcua:namespace",
        "variables": [
          {
            "node_id": "PLC.Main.MotorSpeed",
            "browse_name": "MotorSpeed",
            "display_name": "Motor Speed",
            "datatype": "INT",
            "initial_value": 0,
            "description": "Current motor speed",
            "index": 5,
            "permissions": {
              "viewer": "r",
              "operator": "rw",
              "engineer": "rw"
            }
          }
        ],
        "structures": [],
        "arrays": []
      }
    }
  }
]
```

## 8. Error Handling

### 8.1 Index Resolution Errors

When a variable cannot be resolved:

```typescript
class OpcUaConfigError extends Error {
  constructor(
    public readonly variableRef: string,
    public readonly expectedPath: string,
    public readonly message: string
  ) {
    super(message)
    this.name = 'OpcUaConfigError'
  }
}

// Usage:
if (!match) {
  throw new OpcUaConfigError(
    `${node.pouName}:${node.variablePath}`,
    debugPath,
    `Cannot resolve OPC-UA variable index.\n` +
    `Variable: ${node.pouName}:${node.variablePath}\n` +
    `Expected debug path: ${debugPath}\n` +
    `This may happen if the PLC program was modified after configuring OPC-UA.\n` +
    `Please verify the variable exists in the program.`
  )
}
```

### 8.2 Validation Before Generation

```typescript
const validateAddressSpace = (
  nodes: OpcUaNodeConfig[],
  debugVariables: DebugVariable[]
): { valid: boolean; errors: string[] } => {
  const errors: string[] = []

  for (const node of nodes) {
    try {
      resolveVariableIndex(node, debugVariables)
    } catch (e) {
      errors.push((e as Error).message)
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}
```

## 9. Integration with Compiler

The OPC-UA JSON generation is called as part of the compilation process:

```typescript
// In compiler-module.ts

async handleGenerateOpcUaConfig(
  sourceTargetFolderPath: string,
  projectData: PLCProjectData
): Promise<void> {
  // Check if OPC-UA is enabled
  const opcuaServer = projectData.servers?.find(
    s => s.protocol === 'opcua' && s.opcuaServerConfig?.server.enabled
  )

  if (!opcuaServer) {
    // OPC-UA not configured, skip
    return
  }

  // Read the debug.c file generated by xml2st
  const debugCPath = join(sourceTargetFolderPath, 'debug.c')
  const debugContent = await readFile(debugCPath, 'utf-8')

  // Generate the OPC-UA configuration
  const opcuaJson = generateOpcUaConfig(projectData.servers, debugContent)

  if (opcuaJson) {
    // Write to conf/opcua.json
    const confDir = join(sourceTargetFolderPath, 'conf')
    await mkdir(confDir, { recursive: true })
    await writeFile(join(confDir, 'opcua.json'), opcuaJson, 'utf-8')
  }
}
```
