# S7Comm Server Configuration Implementation Plan

This document outlines the implementation plan for adding Siemens S7Comm server configuration support to the OpenPLC Editor. The implementation follows the existing Modbus server pattern and integrates with the S7Comm plugin on the OpenPLC Runtime.

## Table of Contents

- [Overview](#overview)
- [S7Comm Plugin Configuration Reference](#s7comm-plugin-configuration-reference)
- [Implementation Phases](#implementation-phases)
  - [Phase 1: Type Definitions](#phase-1-type-definitions)
  - [Phase 2: State Management](#phase-2-state-management)
  - [Phase 3: Configuration Generation](#phase-3-configuration-generation)
  - [Phase 4: Compiler Integration](#phase-4-compiler-integration)
  - [Phase 5: UI Components](#phase-5-ui-components)
  - [Phase 6: Enable S7Comm in UI](#phase-6-enable-s7comm-in-ui)
- [Files Summary](#files-summary)
- [Testing Checklist](#testing-checklist)

---

## Overview

The S7Comm plugin allows OpenPLC Runtime to act as a Siemens S7 protocol server, enabling communication with Siemens HMIs and SCADA systems. The editor needs to provide a configuration interface that generates the JSON configuration file expected by the runtime plugin.

### Architecture Flow

```
User UI (Editor)
    ↓ createServer('s7comm')
ProjectSlice (Zustand State)
    ↓ stores s7commSlaveConfig
S7CommServerEditor (React Component)
    ↓ updateS7CommServerConfig()
ProjectSlice
    ↓ updates configuration
Compiler.compileProgram()
    ↓ calls handleGenerateS7CommConfig()
generateS7CommConfig()
    ↓ converts to runtime format
File: conf/s7comm.json
    ↓ sent to runtime via upload
Runtime S7Comm Plugin
    ↓ loads configuration
S7 Server starts on configured port
```

---

## S7Comm Plugin Configuration Reference

The runtime S7Comm plugin expects a JSON configuration file with the following structure:

### Server Configuration

| Field | Type | Required | Default | Range | Description |
|-------|------|----------|---------|-------|-------------|
| `enabled` | boolean | No | `true` | - | Enable/disable the S7 server |
| `bind_address` | string | No | `"0.0.0.0"` | Valid IP | Network interface to bind |
| `port` | integer | No | `102` | 1-65535 | TCP port (102 is standard S7) |
| `max_clients` | integer | No | `32` | 1-1024 | Maximum simultaneous connections |
| `work_interval_ms` | integer | No | `100` | 1-10000 | Worker thread polling interval |
| `send_timeout_ms` | integer | No | `3000` | 100-60000 | Socket send timeout |
| `recv_timeout_ms` | integer | No | `3000` | 100-60000 | Socket receive timeout |
| `ping_timeout_ms` | integer | No | `10000` | 1000-300000 | Keep-alive timeout |
| `pdu_size` | integer | No | `480` | 240-960 | Maximum PDU size per S7 spec |

> **Note:** Port 102 requires root/administrator privileges on most systems.

### PLC Identity Configuration

These values are returned in S7 SZL (System Status List) queries for HMI compatibility:

| Field | Type | Required | Default | Max Length | Description |
|-------|------|----------|---------|------------|-------------|
| `name` | string | No | `"OpenPLC Runtime"` | 64 chars | PLC display name |
| `module_type` | string | No | `"CPU 315-2 PN/DP"` | 64 chars | CPU type string |
| `serial_number` | string | No | `"S C-XXXXXXXXX"` | 64 chars | Serial number |
| `copyright` | string | No | `"OpenPLC Project"` | 64 chars | Copyright string |
| `module_name` | string | No | `"OpenPLC"` | 64 chars | Module name |

### Data Blocks Configuration

Data blocks map S7 protocol DB areas to OpenPLC buffers. Maximum 64 data blocks supported.

```json
{
  "db_number": 1,
  "description": "Digital Inputs (%IX)",
  "size_bytes": 128,
  "mapping": {
    "type": "bool_input",
    "start_buffer": 0,
    "bit_addressing": true
  }
}
```

#### Data Block Fields

| Field | Type | Required | Constraints | Description |
|-------|------|----------|-------------|-------------|
| `db_number` | integer | **Yes** | 1-65535, unique | S7 DB number |
| `description` | string | No | Max 128 chars | Human-readable description |
| `size_bytes` | integer | **Yes** | 1-65536 | DB size in bytes |
| `mapping.type` | string | **Yes** | See type list | OpenPLC buffer type |
| `mapping.start_buffer` | integer | No | 0-1023 | Starting buffer index |
| `mapping.bit_addressing` | boolean | No | - | Enable bit-level access |

#### Supported Buffer Types

| Type | IEC Address | Element Size | Direction | Description |
|------|-------------|--------------|-----------|-------------|
| `bool_input` | %IX | 1 bit | Read | Digital inputs |
| `bool_output` | %QX | 1 bit | Read/Write | Digital outputs |
| `bool_memory` | %MX | 1 bit | Read/Write | Internal markers |
| `byte_input` | %IB | 1 byte | Read | Byte inputs |
| `byte_output` | %QB | 1 byte | Read/Write | Byte outputs |
| `int_input` | %IW | 2 bytes | Read | Word inputs (UINT) |
| `int_output` | %QW | 2 bytes | Read/Write | Word outputs (UINT) |
| `int_memory` | %MW | 2 bytes | Read/Write | Word memory (UINT) |
| `dint_input` | %ID | 4 bytes | Read | Double word inputs (UDINT) |
| `dint_output` | %QD | 4 bytes | Read/Write | Double word outputs (UDINT) |
| `dint_memory` | %MD | 4 bytes | Read/Write | Double word memory (UDINT) |
| `lint_input` | %IL | 8 bytes | Read | Long word inputs (ULINT) |
| `lint_output` | %QL | 8 bytes | Read/Write | Long word outputs (ULINT) |
| `lint_memory` | %ML | 8 bytes | Read/Write | Long word memory (ULINT) |

### System Areas Configuration

System areas provide standard S7 address space mapping (PE, PA, MK):

| Area | S7 Code | S7 Address | OpenPLC Default | Description |
|------|---------|------------|-----------------|-------------|
| `pe_area` | 0x81 | I | %IX | Process inputs |
| `pa_area` | 0x82 | Q | %QX | Process outputs |
| `mk_area` | 0x83 | M | %MX | Markers/flags |

### Logging Configuration

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `log_connections` | boolean | `true` | Log client connect/disconnect |
| `log_data_access` | boolean | `false` | Log read/write operations (verbose) |
| `log_errors` | boolean | `true` | Log errors and warnings |

---

## Implementation Phases

### Phase 1: Type Definitions

**File:** `src/types/PLC/open-plc.ts`

Add Zod schemas for S7Comm configuration validation and type inference.

#### New Schemas to Add

```typescript
// S7Comm Buffer Type Enumeration
const S7CommBufferTypeSchema = z.enum([
  'bool_input',
  'bool_output',
  'bool_memory',
  'byte_input',
  'byte_output',
  'int_input',
  'int_output',
  'int_memory',
  'dint_input',
  'dint_output',
  'dint_memory',
  'lint_input',
  'lint_output',
  'lint_memory',
])

// S7Comm Server Configuration Schema
const S7CommServerSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  bindAddress: z.string().default('0.0.0.0'),
  port: z.number().min(1).max(65535).default(102),
  maxClients: z.number().min(1).max(1024).default(32),
  workIntervalMs: z.number().min(1).max(10000).default(100),
  sendTimeoutMs: z.number().min(100).max(60000).default(3000),
  recvTimeoutMs: z.number().min(100).max(60000).default(3000),
  pingTimeoutMs: z.number().min(1000).max(300000).default(10000),
  pduSize: z.number().min(240).max(960).default(480),
})

// PLC Identity Schema
const S7CommPlcIdentitySchema = z.object({
  name: z.string().max(64).default('OpenPLC Runtime'),
  moduleType: z.string().max(64).default('CPU 315-2 PN/DP'),
  serialNumber: z.string().max(64).default('S C-OPENPLC01'),
  copyright: z.string().max(64).default('OpenPLC Project'),
  moduleName: z.string().max(64).default('OpenPLC'),
})

// Buffer Mapping Schema
const S7CommBufferMappingSchema = z.object({
  type: S7CommBufferTypeSchema,
  startBuffer: z.number().min(0).max(1023).default(0),
  bitAddressing: z.boolean().default(false),
})

// Data Block Schema
const S7CommDataBlockSchema = z.object({
  dbNumber: z.number().min(1).max(65535),
  description: z.string().max(128).default(''),
  sizeBytes: z.number().min(1).max(65536),
  mapping: S7CommBufferMappingSchema,
})

// System Area Schema
const S7CommSystemAreaSchema = z.object({
  enabled: z.boolean().default(false),
  sizeBytes: z.number().min(1).max(65536).default(128),
  mapping: S7CommBufferMappingSchema.optional(),
})

// System Areas Container Schema
const S7CommSystemAreasSchema = z.object({
  peArea: S7CommSystemAreaSchema.optional(),
  paArea: S7CommSystemAreaSchema.optional(),
  mkArea: S7CommSystemAreaSchema.optional(),
})

// Logging Schema
const S7CommLoggingSchema = z.object({
  logConnections: z.boolean().default(true),
  logDataAccess: z.boolean().default(false),
  logErrors: z.boolean().default(true),
})

// Complete S7Comm Slave Config Schema
const S7CommSlaveConfigSchema = z.object({
  server: S7CommServerSettingsSchema,
  plcIdentity: S7CommPlcIdentitySchema.optional(),
  dataBlocks: z.array(S7CommDataBlockSchema).max(64).default([]),
  systemAreas: S7CommSystemAreasSchema.optional(),
  logging: S7CommLoggingSchema.optional(),
})
```

#### Update PLCServerSchema

```typescript
const PLCServerSchema = z.object({
  name: z.string(),
  protocol: PLCServerProtocolSchema,
  modbusSlaveConfig: ModbusSlaveConfigSchema.optional(),
  s7commSlaveConfig: S7CommSlaveConfigSchema.optional(), // Add this line
})
```

#### Export Types

```typescript
export type S7CommBufferType = z.infer<typeof S7CommBufferTypeSchema>
export type S7CommServerSettings = z.infer<typeof S7CommServerSettingsSchema>
export type S7CommPlcIdentity = z.infer<typeof S7CommPlcIdentitySchema>
export type S7CommBufferMapping = z.infer<typeof S7CommBufferMappingSchema>
export type S7CommDataBlock = z.infer<typeof S7CommDataBlockSchema>
export type S7CommSystemArea = z.infer<typeof S7CommSystemAreaSchema>
export type S7CommSystemAreas = z.infer<typeof S7CommSystemAreasSchema>
export type S7CommLogging = z.infer<typeof S7CommLoggingSchema>
export type S7CommSlaveConfig = z.infer<typeof S7CommSlaveConfigSchema>
```

---

### Phase 2: State Management

**File:** `src/renderer/store/slices/project/slice.ts`

Add Zustand actions for S7Comm configuration management.

#### New Actions

```typescript
// Update S7Comm server settings (enabled, port, timeouts, etc.)
updateS7CommServerSettings: (
  serverName: string,
  settings: Partial<S7CommServerSettings>
) => void

// Update PLC identity configuration
updateS7CommPlcIdentity: (
  serverName: string,
  identity: Partial<S7CommPlcIdentity>
) => void

// Add a new data block
addS7CommDataBlock: (
  serverName: string,
  dataBlock: S7CommDataBlock
) => void

// Update an existing data block
updateS7CommDataBlock: (
  serverName: string,
  dbNumber: number,
  updates: Partial<S7CommDataBlock>
) => void

// Remove a data block
removeS7CommDataBlock: (
  serverName: string,
  dbNumber: number
) => void

// Update system area configuration
updateS7CommSystemArea: (
  serverName: string,
  area: 'peArea' | 'paArea' | 'mkArea',
  config: Partial<S7CommSystemArea>
) => void

// Update logging configuration
updateS7CommLogging: (
  serverName: string,
  logging: Partial<S7CommLogging>
) => void
```

#### Modify createServer Action

Update the `createServer` action to initialize default S7Comm configuration:

```typescript
createServer: (request) => {
  // ... existing validation ...

  const newServer: PLCServer = {
    name: request.name,
    protocol: request.protocol,
    // Initialize config based on protocol
    ...(request.protocol === 'modbus-tcp' && {
      modbusSlaveConfig: {
        enabled: false,
        networkInterface: '0.0.0.0',
        port: 502,
      },
    }),
    ...(request.protocol === 's7comm' && {
      s7commSlaveConfig: {
        server: {
          enabled: false,
          bindAddress: '0.0.0.0',
          port: 102,
          maxClients: 32,
          workIntervalMs: 100,
          sendTimeoutMs: 3000,
          recvTimeoutMs: 3000,
          pingTimeoutMs: 10000,
          pduSize: 480,
        },
        dataBlocks: [],
      },
    }),
  }

  // ... rest of implementation ...
}
```

#### Default Data Blocks

Consider providing a helper function to add common default data blocks:

```typescript
const DEFAULT_S7COMM_DATA_BLOCKS: S7CommDataBlock[] = [
  {
    dbNumber: 1,
    description: 'Digital Inputs (%IX)',
    sizeBytes: 128,
    mapping: { type: 'bool_input', startBuffer: 0, bitAddressing: true },
  },
  {
    dbNumber: 2,
    description: 'Digital Outputs (%QX)',
    sizeBytes: 128,
    mapping: { type: 'bool_output', startBuffer: 0, bitAddressing: true },
  },
  {
    dbNumber: 10,
    description: 'Analog Inputs (%IW)',
    sizeBytes: 2048,
    mapping: { type: 'int_input', startBuffer: 0, bitAddressing: false },
  },
  {
    dbNumber: 20,
    description: 'Analog Outputs (%QW)',
    sizeBytes: 2048,
    mapping: { type: 'int_output', startBuffer: 0, bitAddressing: false },
  },
]
```

---

### Phase 3: Configuration Generation

**New File:** `src/utils/s7comm/generate-s7comm-config.ts`

Create the JSON configuration generator that converts editor state to runtime format.

```typescript
import type { PLCServer, S7CommSlaveConfig } from '@root/types/PLC/open-plc'

/**
 * Generates the S7Comm configuration JSON for the runtime plugin.
 * Converts camelCase properties to snake_case expected by the C plugin.
 *
 * @param servers - Array of configured PLC servers
 * @returns JSON string for s7comm.json or null if no enabled S7Comm server
 */
export function generateS7CommConfig(servers: PLCServer[]): string | null {
  const s7commServer = servers.find(
    (server) =>
      server.protocol === 's7comm' &&
      server.s7commSlaveConfig?.server.enabled
  )

  if (!s7commServer?.s7commSlaveConfig) {
    return null
  }

  const config = s7commServer.s7commSlaveConfig

  const runtimeConfig = {
    server: {
      enabled: config.server.enabled,
      bind_address: config.server.bindAddress,
      port: config.server.port,
      max_clients: config.server.maxClients,
      work_interval_ms: config.server.workIntervalMs,
      send_timeout_ms: config.server.sendTimeoutMs,
      recv_timeout_ms: config.server.recvTimeoutMs,
      ping_timeout_ms: config.server.pingTimeoutMs,
      pdu_size: config.server.pduSize,
    },

    ...(config.plcIdentity && {
      plc_identity: {
        name: config.plcIdentity.name,
        module_type: config.plcIdentity.moduleType,
        serial_number: config.plcIdentity.serialNumber,
        copyright: config.plcIdentity.copyright,
        module_name: config.plcIdentity.moduleName,
      },
    }),

    data_blocks: config.dataBlocks.map((db) => ({
      db_number: db.dbNumber,
      description: db.description,
      size_bytes: db.sizeBytes,
      mapping: {
        type: db.mapping.type,
        start_buffer: db.mapping.startBuffer,
        bit_addressing: db.mapping.bitAddressing,
      },
    })),

    ...(config.systemAreas && {
      system_areas: {
        ...(config.systemAreas.peArea && {
          pe_area: {
            enabled: config.systemAreas.peArea.enabled,
            size_bytes: config.systemAreas.peArea.sizeBytes,
            ...(config.systemAreas.peArea.mapping && {
              mapping: {
                type: config.systemAreas.peArea.mapping.type,
                start_buffer: config.systemAreas.peArea.mapping.startBuffer,
              },
            }),
          },
        }),
        ...(config.systemAreas.paArea && {
          pa_area: {
            enabled: config.systemAreas.paArea.enabled,
            size_bytes: config.systemAreas.paArea.sizeBytes,
            ...(config.systemAreas.paArea.mapping && {
              mapping: {
                type: config.systemAreas.paArea.mapping.type,
                start_buffer: config.systemAreas.paArea.mapping.startBuffer,
              },
            }),
          },
        }),
        ...(config.systemAreas.mkArea && {
          mk_area: {
            enabled: config.systemAreas.mkArea.enabled,
            size_bytes: config.systemAreas.mkArea.sizeBytes,
            ...(config.systemAreas.mkArea.mapping && {
              mapping: {
                type: config.systemAreas.mkArea.mapping.type,
                start_buffer: config.systemAreas.mkArea.mapping.startBuffer,
              },
            }),
          },
        }),
      },
    }),

    ...(config.logging && {
      logging: {
        log_connections: config.logging.logConnections,
        log_data_access: config.logging.logDataAccess,
        log_errors: config.logging.logErrors,
      },
    }),
  }

  return JSON.stringify(runtimeConfig, null, 2)
}
```

**New File:** `src/utils/s7comm/index.ts`

```typescript
export { generateS7CommConfig } from './generate-s7comm-config'
```

---

### Phase 4: Compiler Integration

**File:** `src/main/modules/compiler/compiler-module.ts`

Add the S7Comm configuration file generation to the compilation pipeline.

#### Add Import

```typescript
import { generateS7CommConfig } from '@utils/s7comm'
```

#### Add New Method

```typescript
/**
 * Generates the S7Comm server configuration file for the runtime plugin.
 * Creates conf/s7comm.json if an S7Comm server is enabled.
 */
async handleGenerateS7CommConfig(
  sourceTargetFolderPath: string,
  projectData: ProjectState['data'],
  handleOutputData: HandleOutputDataCallback,
): Promise<void> {
  const s7commConfig = generateS7CommConfig(projectData.servers)

  if (s7commConfig) {
    const confFolderPath = join(sourceTargetFolderPath, 'conf')
    await mkdir(confFolderPath, { recursive: true })

    const configFilePath = join(confFolderPath, 's7comm.json')
    await writeFile(configFilePath, s7commConfig, 'utf-8')

    handleOutputData('Generated conf/s7comm.json', 'info')
  }
}
```

#### Update Compilation Pipeline

Find the location where `handleGenerateModbusSlaveConfig` is called and add the S7Comm generation alongside it:

```typescript
// Generate protocol configurations
await this.handleGenerateModbusSlaveConfig(sourceTargetFolderPath, projectData, handleOutputData)
await this.handleGenerateModbusMasterConfig(sourceTargetFolderPath, projectData, handleOutputData)
await this.handleGenerateS7CommConfig(sourceTargetFolderPath, projectData, handleOutputData) // Add this
```

---

### Phase 5: UI Components

Create the S7Comm server editor UI components.

**New Directory:** `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/`

#### Component Structure

```
s7comm-server/
├── index.tsx                    # Main S7Comm server editor
├── server-config-section.tsx    # Server network settings
├── plc-identity-section.tsx     # PLC identity configuration
├── data-blocks-section.tsx      # Data blocks list
├── data-block-modal.tsx         # Modal for add/edit data block
├── system-areas-section.tsx     # PE/PA/MK area configuration
└── logging-section.tsx          # Logging toggles
```

#### Main Editor Component (`index.tsx`)

```tsx
import { useOpenPLCStore } from '@root/renderer/store'
import { ServerConfigSection } from './server-config-section'
import { PlcIdentitySection } from './plc-identity-section'
import { DataBlocksSection } from './data-blocks-section'
import { SystemAreasSection } from './system-areas-section'
import { LoggingSection } from './logging-section'

type S7CommServerEditorProps = {
  serverName: string
}

export const S7CommServerEditor = ({ serverName }: S7CommServerEditorProps) => {
  const { servers } = useOpenPLCStore.useSelector('project').data
  const server = servers.find((s) => s.name === serverName)

  if (!server || server.protocol !== 's7comm' || !server.s7commSlaveConfig) {
    return <div>S7Comm server configuration not found</div>
  }

  const config = server.s7commSlaveConfig

  return (
    <div className="flex h-full w-full flex-col gap-4 overflow-y-auto p-4">
      <ServerConfigSection serverName={serverName} config={config.server} />
      <PlcIdentitySection serverName={serverName} identity={config.plcIdentity} />
      <DataBlocksSection serverName={serverName} dataBlocks={config.dataBlocks} />
      <SystemAreasSection serverName={serverName} systemAreas={config.systemAreas} />
      <LoggingSection serverName={serverName} logging={config.logging} />
    </div>
  )
}
```

#### Server Configuration Section (`server-config-section.tsx`)

UI elements:
- Enable/disable toggle switch
- Bind address dropdown (`0.0.0.0`, `127.0.0.1`)
- Port input with validation (1-65535, note about port 102)
- Max clients input (1-1024)
- Collapsible "Advanced Settings" accordion:
  - Work interval (ms)
  - Send timeout (ms)
  - Receive timeout (ms)
  - Ping timeout (ms)
  - PDU size slider (240-960)

#### PLC Identity Section (`plc-identity-section.tsx`)

Collapsible accordion with:
- Name input (max 64 chars)
- Module type input (max 64 chars)
- Serial number input (max 64 chars)
- Copyright input (max 64 chars)
- Module name input (max 64 chars)

Pre-populated with defaults for convenience.

#### Data Blocks Section (`data-blocks-section.tsx`)

Main configuration area:
- Table with columns: DB Number, Description, Size (bytes), Mapping Type, Actions
- "Add Data Block" button
- Edit/Delete icons per row
- Empty state message when no blocks configured
- Option to "Add Default Blocks" for quick setup

#### Data Block Modal (`data-block-modal.tsx`)

Modal dialog for creating/editing data blocks:
- DB Number input (1-65535, unique validation)
- Description input (optional, max 128 chars)
- Size in bytes input (1-65536)
- Mapping type dropdown (all 15 buffer types)
- Start buffer input (0-1023)
- Bit addressing toggle (only shown for bool types)

Validation:
- DB number must be unique
- Size must be positive
- Buffer range must not exceed limits

#### System Areas Section (`system-areas-section.tsx`)

Collapsible accordion with three sub-sections:
- **PE Area (Process Inputs):** Enable toggle, size, mapping config
- **PA Area (Process Outputs):** Enable toggle, size, mapping config
- **MK Area (Markers):** Enable toggle, size, mapping config

Each area shows relevant defaults when enabled.

#### Logging Section (`logging-section.tsx`)

Simple toggle switches:
- Log connections (default: on)
- Log data access (default: off, with "verbose" warning)
- Log errors (default: on)

---

### Phase 6: Enable S7Comm in UI

#### Update Server Creation Modal

**File:** `src/renderer/components/_features/[workspace]/create-element/element-card/index.tsx`

Change the disabled flag for S7Comm:

```typescript
const ServerProtocolSources = [
  { value: 'modbus-tcp', label: 'Modbus/TCP', disabled: false },
  { value: 's7comm', label: 'Siemens S7comm', disabled: false }, // Changed from true
  { value: 'ethernet-ip', label: 'EtherNet/IP', disabled: true },
] as const
```

#### Update Server Editor Export

**File:** `src/renderer/components/_features/[workspace]/editor/server/index.ts`

```typescript
export { ModbusServerEditor } from './modbus-server'
export { S7CommServerEditor } from './s7comm-server'
```

#### Update Editor Tab Routing

Find where server tabs are rendered (likely in the workspace editor area) and add routing for S7Comm:

```tsx
{server.protocol === 'modbus-tcp' && (
  <ModbusServerEditor serverName={server.name} />
)}
{server.protocol === 's7comm' && (
  <S7CommServerEditor serverName={server.name} />
)}
```

---

## Files Summary

### Files to Create

| File | Purpose |
|------|---------|
| `src/utils/s7comm/generate-s7comm-config.ts` | JSON configuration generator |
| `src/utils/s7comm/index.ts` | Utils barrel export |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/index.tsx` | Main editor component |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/server-config-section.tsx` | Server settings UI |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/plc-identity-section.tsx` | PLC identity UI |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/data-blocks-section.tsx` | Data blocks list UI |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/data-block-modal.tsx` | Data block add/edit modal |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/system-areas-section.tsx` | System areas UI |
| `src/renderer/components/_features/[workspace]/editor/server/s7comm-server/logging-section.tsx` | Logging toggles UI |

### Files to Modify

| File | Changes |
|------|---------|
| `src/types/PLC/open-plc.ts` | Add S7Comm Zod schemas and types |
| `src/renderer/store/slices/project/slice.ts` | Add S7Comm state actions |
| `src/main/modules/compiler/compiler-module.ts` | Add S7Comm config generation |
| `src/renderer/components/_features/[workspace]/create-element/element-card/index.tsx` | Enable S7Comm option |
| `src/renderer/components/_features/[workspace]/editor/server/index.ts` | Export S7CommServerEditor |

---

## Testing Checklist

### Unit Tests

- [ ] S7Comm Zod schema validation
- [ ] `generateS7CommConfig` function with various configurations
- [ ] State actions for all S7Comm operations
- [ ] Data block uniqueness validation

### Integration Tests

- [ ] Create S7Comm server via UI
- [ ] Edit server configuration
- [ ] Add/edit/delete data blocks
- [ ] Configuration persists across sessions
- [ ] JSON file generated during compilation

### Manual Testing

- [ ] S7Comm option visible and enabled in server creation modal
- [ ] Server configuration section renders correctly
- [ ] All input fields validate properly
- [ ] Data block modal opens/closes correctly
- [ ] Table updates when data blocks change
- [ ] Advanced settings accordion collapses/expands
- [ ] Generated JSON matches runtime expectations
- [ ] Runtime successfully loads generated configuration

### Edge Cases

- [ ] Empty data blocks array
- [ ] Maximum 64 data blocks
- [ ] Duplicate DB number validation
- [ ] Port 102 privilege warning
- [ ] Buffer range overflow validation
- [ ] Very long description strings (128 char limit)

---

## References

- [OpenPLC Runtime S7Comm Plugin Documentation](../../../openplc-runtime/docs/)
- [S7Comm Protocol Specification](https://snap7.sourceforge.net/)
- [Existing Modbus Server Implementation](../src/renderer/components/_features/[workspace]/editor/server/modbus-server/)
