# OPC-UA Server Configuration - Design Overview

## 1. Architecture Overview

### 1.1 System Context

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           OpenPLC Editor                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    OPC-UA Configuration UI                       │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐   │   │
│  │  │ General  │ │ Security │ │  Users   │ │  Address Space   │   │   │
│  │  │ Settings │ │ Profiles │ │          │ │  (Variables)     │   │   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │              Project State (Zustand Store)                       │   │
│  │              - OPC-UA config stored WITHOUT indices              │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                  │                                      │
│                                  ▼ (on compile)                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      Compiler Module                             │   │
│  │  1. xml2st generates debug.c (with variable indices)            │   │
│  │  2. Parse debug.c to get index mapping                          │   │
│  │  3. Resolve variable references → indices                       │   │
│  │  4. Generate opcua.json with resolved indices                   │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          OpenPLC Runtime                                 │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                      OPC-UA Plugin                               │   │
│  │              Reads opcua.json configuration                      │   │
│  │              Exposes variables via OPC-UA protocol               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Configuration Flow

The OPC-UA configuration follows a two-phase approach:

#### Phase 1: Configuration Time (No Compilation Required)

1. User opens OPC-UA server configuration from the Servers panel
2. User configures server settings, security profiles, users
3. User selects variables from the project's POU tree structure
4. User configures OPC-UA properties for each selected variable (node ID, permissions, etc.)
5. Configuration is saved in the project file **without variable indices**

#### Phase 2: Compilation Time (Index Resolution)

1. User compiles the project
2. xml2st generates `debug.c` with all variable indices
3. Compiler parses `debug.c` using existing `parseDebugFile()` function
4. Compiler matches user's selected variables to their debug indices
5. Compiler generates `opcua.json` with fully resolved indices
6. `opcua.json` is included in the compiled project package

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Configuration Flow Diagram                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌────────────────────┐      ┌────────────────────┐                     │
│  │   Project POUs     │      │  OPC-UA Config UI  │                     │
│  │ (Programs, FBs,    │ ───► │  (Select Variables │                     │
│  │  Global Variables) │      │   Configure Props) │                     │
│  └────────────────────┘      └─────────┬──────────┘                     │
│                                        │                                 │
│                                        ▼                                 │
│                              ┌────────────────────┐                     │
│                              │   Project File     │                     │
│                              │ (Config WITHOUT    │                     │
│                              │  indices)          │                     │
│                              └─────────┬──────────┘                     │
│                                        │                                 │
│                                        ▼ [User clicks Compile]          │
│                              ┌────────────────────┐                     │
│                              │   xml2st           │                     │
│                              │ (Generates debug.c)│                     │
│                              └─────────┬──────────┘                     │
│                                        │                                 │
│                                        ▼                                 │
│  ┌────────────────────┐      ┌────────────────────┐                     │
│  │   parseDebugFile() │ ◄─── │     debug.c        │                     │
│  │ (Extract indices)  │      │ (Variable indices) │                     │
│  └─────────┬──────────┘      └────────────────────┘                     │
│            │                                                             │
│            ▼                                                             │
│  ┌────────────────────┐      ┌────────────────────┐                     │
│  │  Resolve indices   │ ───► │    opcua.json      │                     │
│  │  for each variable │      │ (WITH indices)     │                     │
│  └────────────────────┘      └────────────────────┘                     │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 2. Integration with Existing Systems

### 2.1 Debugger Integration

The OPC-UA plugin uses the **same debug variable indices** as the OpenPLC debugger. This means:

- We reuse `parseDebugFile()` from `src/renderer/utils/parse-debug-file.ts`
- We reuse the path matching logic from the debugger implementation
- Variable indices are consistent between debugger and OPC-UA access

### 2.2 Project Structure Integration

OPC-UA configuration follows the same patterns as Modbus and S7Comm:

- Configuration stored in `project.data.servers[]` array
- Protocol discriminated by `server.protocol === 'opcua'`
- Configuration in `server.opcuaServerConfig` object

### 2.3 Compiler Integration

The compiler module generates `opcua.json` similar to how it generates `modbus_slave.json` and `s7comm.json`:

```typescript
// In compiler-module.ts
async handleGenerateOpcUaConfig(sourceTargetFolderPath, projectData) {
  const opcuaConfig = generateOpcUaConfig(
    projectData.servers,
    parsedDebugVariables  // From debug.c parsing
  )
  if (opcuaConfig) {
    await writeFile(
      join(sourceTargetFolderPath, 'conf', 'opcua.json'),
      opcuaConfig
    )
  }
}
```

## 3. Data Model

### 3.1 Editor Data Model (Stored in Project - No Indices)

```typescript
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
    nodes: OpcUaNodeConfig[]  // Hierarchical tree of selected nodes
  }
}

// Variable/Node configuration WITHOUT index
interface OpcUaNodeConfig {
  id: string                    // UUID

  // Reference to PLC variable (resolved to index at compile time)
  pouName: string               // "main", "GVL", "FB_Motor"
  variablePath: string          // "MOTOR_SPEED", "TON0.ET", "SENSOR.temperature"
  variableType: string          // IEC type: "INT", "BOOL", "REAL", etc.

  // OPC-UA node configuration
  nodeId: string                // "PLC.Main.MotorSpeed"
  browseName: string
  displayName: string
  description: string
  initialValue: any
  permissions: {
    viewer: 'r' | 'w' | 'rw'
    operator: 'r' | 'w' | 'rw'
    engineer: 'r' | 'w' | 'rw'
  }

  // For complex types
  nodeType: 'variable' | 'structure' | 'array'
  children?: OpcUaNodeConfig[]  // For structures: field configs
  arrayLength?: number          // For arrays: element count
}
```

### 3.2 Runtime Data Model (Generated JSON - With Indices)

The runtime expects a JSON array with the following structure:

```typescript
interface OpcUaRuntimeConfig {
  name: string                  // "opcua_server"
  protocol: "OPC-UA"
  config: {
    server: {
      name: string
      application_uri: string
      product_uri: string
      endpoint_url: string      // Full URL: opc.tcp://host:port/path
      security_profiles: RuntimeSecurityProfile[]
    }
    security: {
      server_certificate_strategy: string
      server_certificate_custom: string | null
      server_private_key_custom: string | null
      trusted_client_certificates: { id: string; pem: string }[]
    }
    users: RuntimeUser[]
    cycle_time_ms: number
    address_space: {
      namespace_uri: string
      variables: RuntimeVariable[]    // With resolved indices
      structures: RuntimeStructure[]  // With resolved field indices
      arrays: RuntimeArray[]          // With resolved start indices
    }
  }
}
```

## 4. Variable Hierarchy Support

### 4.1 Hierarchical Variable Structure

PLC programs can have deeply nested variable structures:

```
Program: main
├── MOTOR_SPEED (INT)                           → Simple variable
├── IS_RUNNING (BOOL)                           → Simple variable
├── MOTOR_CONTROLLER (FB_MotorControl)          → Function Block instance
│   ├── ENABLE (BOOL)                           → FB input
│   ├── SPEED_SETPOINT (INT)                    → FB input
│   ├── ACTUAL_SPEED (INT)                      → FB output
│   └── PID_CTRL (FB_PID)                       → Nested FB
│       ├── KP (REAL)
│       ├── KI (REAL)
│       └── OUTPUT (REAL)
├── SENSOR_DATA (T_SensorData)                  → Structure
│   ├── temperature (REAL)                      → Struct field
│   ├── pressure (REAL)                         → Struct field
│   └── status (T_Status)                       → Nested structure
│       ├── is_valid (BOOL)
│       └── error_code (INT)
├── TEMPERATURES (ARRAY[1..10] OF REAL)         → Array
└── SENSOR_ARRAY (ARRAY[1..5] OF T_SensorData)  → Array of structures
    └── [1] (T_SensorData)
        ├── temperature (REAL)
        └── ...
```

### 4.2 Debug Path Format

The debugger uses specific path formats for each variable type:

| Type | Debug Path Format | Example |
|------|-------------------|---------|
| Simple | `RES0__INSTANCE.VARNAME` | `RES0__INSTANCE0.MOTOR_SPEED` |
| FB Variable | `RES0__INSTANCE.FBVAR.FIELD` | `RES0__INSTANCE0.MOTOR_CONTROLLER.ENABLE` |
| Nested FB | `RES0__INSTANCE.FB1.FB2.FIELD` | `RES0__INSTANCE0.MOTOR_CONTROLLER.PID_CTRL.KP` |
| Struct Field | `RES0__INSTANCE.VAR.value.FIELD` | `RES0__INSTANCE0.SENSOR_DATA.value.temperature` |
| Nested Struct | `RES0__INSTANCE.VAR.value.NESTED.value.FIELD` | `RES0__INSTANCE0.SENSOR_DATA.value.status.value.is_valid` |
| Array Element | `RES0__INSTANCE.VAR.value.table[i]` | `RES0__INSTANCE0.TEMPERATURES.value.table[0]` |
| Global | `CONFIG0__VARNAME` | `CONFIG0__SYSTEM_STATE` |

### 4.3 Index Resolution at Compile Time

```typescript
const resolveVariableIndex = (
  pouName: string,
  variablePath: string,
  debugVariables: DebugVariable[]
): number => {
  // Build the debug path based on variable type
  const debugPath = buildDebugPath(pouName, variablePath)

  // Find matching entry in parsed debug.c
  const debugVar = debugVariables.find(dv =>
    dv.name.toUpperCase() === debugPath.toUpperCase()
  )

  if (!debugVar) {
    throw new Error(`Cannot resolve index for ${pouName}:${variablePath}`)
  }

  return debugVar.index
}

const buildDebugPath = (pouName: string, variablePath: string): string => {
  // Handle global variables
  if (pouName === 'GVL' || pouName === 'CONFIG') {
    return `CONFIG0__${variablePath.toUpperCase()}`
  }

  // Handle program/FB instance variables
  // The instance name format depends on resource configuration
  return `RES0__INSTANCE0.${variablePath.toUpperCase()}`
}
```

## 5. Security Model

### 5.1 Security Profiles

OPC-UA supports multiple security profiles that can be enabled simultaneously:

| Profile | Security Policy | Security Mode | Auth Methods |
|---------|-----------------|---------------|--------------|
| Insecure | None | None | Anonymous |
| Signed | Basic256Sha256 | Sign | Username, Certificate |
| Encrypted | Basic256Sha256 | SignAndEncrypt | Username, Certificate |

### 5.2 User Roles and Permissions

Three user roles with different access levels:

| Role | Description | Default Variable Access |
|------|-------------|------------------------|
| Viewer | Read-only monitoring | Read only |
| Operator | Can modify operational variables | Read/Write (configurable) |
| Engineer | Full administrative access | Read/Write |

Each variable can have custom permissions per role.

## 6. File Structure

```
src/
├── types/PLC/
│   └── open-plc.ts                    # Add OPC-UA type schemas
├── utils/
│   └── opcua/
│       ├── generate-opcua-config.ts   # JSON generator with index resolution
│       ├── bcrypt-utils.ts            # Password hashing utilities
│       └── index.ts
├── renderer/
│   ├── utils/
│   │   └── parse-debug-file.ts        # REUSE for index resolution
│   ├── store/slices/project/
│   │   └── slice.ts                   # Add OPC-UA actions
│   └── components/_features/[workspace]/editor/
│       └── server/
│           └── opcua-server/
│               ├── index.tsx          # Main tabbed component
│               ├── tabs/
│               │   ├── general-settings.tsx
│               │   ├── security-profiles.tsx
│               │   ├── certificates.tsx
│               │   ├── users.tsx
│               │   └── address-space.tsx
│               └── components/
│                   ├── variable-tree.tsx
│                   ├── variable-config-modal.tsx
│                   └── ...
└── main/modules/compiler/
    └── compiler-module.ts             # Add OPC-UA JSON generation
```

## 7. Key Design Decisions

### 7.1 Index Resolution at Compile Time

**Decision**: Store variable references (pouName + variablePath) in project, resolve indices only during compilation.

**Rationale**:
- Users can configure OPC-UA without building first
- Indices may change when program is modified
- Consistent with how debugger works

### 7.2 Reuse Debugger Infrastructure

**Decision**: Reuse `parseDebugFile()` and path matching logic from debugger.

**Rationale**:
- OPC-UA plugin uses same debug indices as debugger
- Proven, tested code
- Maintains consistency

### 7.3 Tabbed UI Interface

**Decision**: Use tabbed interface instead of single scrollable page.

**Rationale**:
- OPC-UA configuration is significantly more complex than Modbus/S7Comm
- Tabs help organize related settings
- Reduces cognitive load on users

### 7.4 Tree-Based Variable Selection

**Decision**: Display all project variables in a tree structure, allowing selection of individual leaves or entire branches (structures/arrays).

**Rationale**:
- Supports deeply nested hierarchies (FB inside FB inside Program)
- Intuitive selection of complex types
- Consistent with how POUs are structured
