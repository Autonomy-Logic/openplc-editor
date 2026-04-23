# EtherCAT Architecture — OpenPLC Editor

Complete architectural reference of the EtherCAT functionality, from device creation to runtime JSON generation.

---

## 1. Overview

The EtherCAT system spans both Electron processes:

```
Main Process (Node.js)                    Renderer Process (React)
├── ESI Service (parse, store, query)     ├── Zustand Store (project state)
├── IPC Handlers (scan, status, ESI)      ├── EtherCAT Editor (bus-level UI)
├── Compiler Module (JSON generation)     ├── Device Editor (per-slave UI)
└── Runtime HTTP Client (scan/status)     └── Utilities (matching, config gen)
```

**Key data flow:**
```
ESI XML upload → Parse (main) → Repository (disk)
                                      ↓
Network scan → Match against repo → Add to project → Configure → Generate JSON → Runtime
```

---

## 2. Type System

### Core Types (`src/types/ethercat/esi-types.ts`)

| Type | Purpose |
|------|---------|
| `ESIDevice` | Full parsed ESI device (PDOs, SyncManagers, CoE, FMMUs) |
| `ESIDeviceSummary` | Lightweight summary for repository listing (channel counts, I/O bytes) |
| `ESIChannel` | UI-friendly flattened PDO entry (name, direction, bitLen, offset) |
| `ConfiguredEtherCATDevice` | A device added to the project (config, mappings, persisted PDOs) |
| `EtherCATSlaveConfig` | Per-slave settings (addressing, timeouts, watchdog, DC) |
| `PersistedChannelInfo` / `PersistedPdo` | Runtime-serializable channel/PDO metadata |
| `SDOConfigurationEntry` | CoE SDO startup parameter |
| `ESIRepositoryItemLight` | Repository entry with vendor info and device summaries |
| `ESIDeviceRef` | Pointer to a device in the repository (`repositoryItemId` + `deviceIndex`) |
| `ScannedDeviceMatch` | A scanned device paired with its ESI matches (exact/partial/none) |

### Discovery Types (`src/types/ethercat/index.ts`)

| Type | Purpose |
|------|---------|
| `EtherCATDevice` | Network-discovered device (position, vendor_id, product_code, state) |
| `EtherCATScanResponse` | Scan result (status, devices[], scan_time_ms) |
| `NetworkInterface` | Adapter for scanning (name, description) |
| `EtherCATRuntimeStatusResponse` | Runtime state machine (masters/slaves with states, WKC) |

### Project Persistence (`src/types/PLC/open-plc.ts`)

```typescript
PLCRemoteDevice {
  name: string
  protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet'
  ethercatConfig?: EthercatConfig
}

EthercatConfig {
  masterConfig?: EtherCATMasterConfig  // interface, cycleTimeUs, watchdogTimeoutCycles
  devices: ConfiguredEtherCATDevice[]
}
```

Stored in `project.json` under `data.remoteDevices[]`.

---

## 3. ESI Repository System

### Storage Layout

```
<project>/devices/esi/
├── repository.json          # v2 index with device summaries
├── <uuid-1>.xml             # Individual ESI XML files
├── <uuid-2>.xml
└── ...
```

### ESI Service (`src/main/services/esi-service/index.ts`)

Runs in the **main process**. Key methods:

| Method | Purpose |
|--------|---------|
| `parseAndSaveFile(projectPath, filename, content)` | Parse XML, save with UUID, append to v2 index |
| `loadRepositoryLight(projectPath)` | Fast load from v2 index (pre-computed summaries) |
| `loadDeviceFull(projectPath, itemId, deviceIndex)` | On-demand full parse of a specific device |
| `deleteRepositoryItemV2(projectPath, itemId)` | Remove XML + update index |
| `clearRepository(projectPath)` | Delete all ESI files and index |
| `migrateRepositoryToV2(projectPath)` | Convert v1 (metadata-only) → v2 (with summaries) |

### ESI Parser (`src/main/services/esi-service/esi-parser-main.ts`)

Two parsing modes:

1. **Light** — `parseESILight(xmlString, filename?)` → `ESIDeviceSummary[]`
   - Counts PDO entries without building full structures
   - Returns: `inputChannelCount`, `outputChannelCount`, `totalInputBytes`, `totalOutputBytes`
   - Used for repository listing

2. **Full** — `parseESIDeviceFull(xmlString, deviceIndex)` → `ESIDevice`
   - On-demand when configuring a specific device
   - Returns complete: FMMUs, SyncManagers, RxPDOs, TxPDOs, CoE Objects

Parser details:
- Uses `fast-xml-parser`
- Handles localized text (prefers English LcId 1033)
- Normalizes hex formats (`#x`, `0x`)
- CoE Dictionary: DataTypes + Objects with PDO mapping metadata

### IPC Bridge for ESI

```
Renderer                          Main
window.bridge.esiParseAndSaveFile() → handleESIParseAndSaveFile()
window.bridge.esiLoadRepositoryLight() → handleESILoadRepositoryLight()
window.bridge.esiLoadDeviceFull() → handleESILoadDeviceFull()
window.bridge.esiDeleteXmlFile() → handleESIDeleteXmlFile()
window.bridge.esiClearRepository() → handleESIClearRepository()
window.bridge.esiMigrateRepository() → handleESIMigrateRepository()
```

Defined in `src/main/modules/ipc/main.ts` (handlers) and `src/main/modules/ipc/renderer.ts` (invocations).

---

## 4. Remote Device (Bus) Creation

### Store Action (`src/renderer/store/slices/project/slice.ts`)

`createRemoteDevice(device: PLCRemoteDevice)`:
1. Validates name doesn't conflict with POUs/datatypes
2. Pushes to `project.data.remoteDevices[]`
3. **Auto-creates a system task** for EtherCAT:

```typescript
{
  name: "EtherCAT_<DeviceName>",  // ethercatTaskName()
  triggering: 'Cyclic',
  interval: "T#1ms",              // cycleTimeUsToIecInterval(1000)
  priority: 1,
  isSystemTask: true,
  associatedDevice: deviceName,
}
```

Related actions:
- `deleteRemoteDevice(name)` — removes device + associated system task
- `updateRemoteDeviceName(oldName, newName)` — renames both device and task
- `updateEthercatConfig(deviceName, ethercatConfig)` — updates config and **syncs cycle time to task interval**

### Task Helpers (`src/utils/ethercat/ethercat-task-helpers.ts`)

| Function | Output |
|----------|--------|
| `ethercatTaskName("Master1")` | `"EtherCAT_Master1"` |
| `cycleTimeUsToIecInterval(1000)` | `"T#1ms"` |
| `cycleTimeUsToIecInterval(500)` | `"T#500us"` |

---

## 5. Device Scanning (Online)

### IPC Handlers (`src/main/modules/ipc/main.ts`)

| Handler | Runtime Endpoint | Purpose |
|---------|-----------------|---------|
| `handleEtherCATGetStatus` | `GET /api/discovery/ethercat/status` | Service availability |
| `handleEtherCATGetInterfaces` | `POST /api/plugin-command` | List network adapters |
| `handleEtherCATScan` | `POST /api/plugin-command` | Discover devices on interface |
| `handleEtherCATTest` | `POST /api/discovery/ethercat/test` | Test connection |
| `handleEtherCATValidate` | `POST /api/discovery/ethercat/validate` | Validate configuration |
| `handleEtherCATGetRuntimeStatus` | Runtime API | Master/slave state machine |

Scan request payload:
```json
{
  "plugin": "ethercat",
  "command": "scan",
  "params": { "interface": "eth0", "timeout_ms": 5000 }
}
```

Scan response:
```typescript
{
  status: 'success' | 'error',
  devices: EtherCATDevice[],  // { position, name, vendor_id, product_code, revision, state, input_bytes, output_bytes }
  message: string,
  scan_time_ms: number,
}
```

### Renderer IPC (`src/main/modules/ipc/renderer.ts`)

```typescript
window.bridge.etherCATGetStatus(ipAddress, jwtToken)
window.bridge.etherCATGetInterfaces(ipAddress, jwtToken)
window.bridge.etherCATScan(ipAddress, jwtToken, { interface, timeout_ms })
```

---

## 6. Device Matching

**File:** `src/utils/ethercat/device-matcher.ts`

`matchDevicesToRepository(scannedDevices, repository)` → `ScannedDeviceMatch[]`

Match quality levels:
| Quality | Criteria |
|---------|----------|
| **exact** | Vendor ID + Product Code + Revision all match |
| **partial** | Vendor ID + Product Code match (revision differs) |
| **none** | No match found |

Output per scanned device:
```typescript
{
  device: EtherCATDevice,           // from scan
  matches: DeviceMatch[],           // sorted by quality (best first)
}
```

Helper: `countMatchedDevices(matches)` → `{ total, exact, partial, none }`

---

## 7. Adding a Device to the Project

Two paths:

### A. From Scan (online)

1. User selects matched devices in the scan table
2. `handleAddSelectedFromScan()` in `EtherCATEditor`:
   - Loads full ESI data via `esiLoadDeviceFull()`
   - Enriches with `enrichDeviceData()`
   - Creates `ConfiguredEtherCATDevice` with `addedFrom: 'scan'`
   - Calls `syncDevicesToStore()`

### B. From Repository (offline)

1. User clicks `+` button → `DeviceBrowserModal` opens
2. Selects a device from the ESI repository
3. `handleAddDeviceFromBrowser()` in `EtherCATEditor`:
   - Loads full ESI data via `esiLoadDeviceFull()`
   - Enriches with `enrichDeviceData()`
   - Creates `ConfiguredEtherCATDevice` with `addedFrom: 'repository'`
   - Assigns next available position
   - Calls `syncDevicesToStore()`

### Device Enrichment (`src/utils/ethercat/enrich-device-data.ts`)

`enrichDeviceData(esiDevice)` extracts fields spread into `ConfiguredEtherCATDevice`:

| Field | Source |
|-------|--------|
| `channelInfo: PersistedChannelInfo[]` | `buildChannelInfo()` — full channel metadata with IEC types |
| `rxPdos, txPdos: PersistedPdo[]` | `persistPdos()` — PDOs with padding preserved |
| `slaveType: string` | `deriveSlaveType()` — heuristic: `digital_input`, `analog_output`, `coupler`, etc. |
| `sdoConfigurations: SDOConfigurationEntry[]` | `extractDefaultSdoConfigurations()` — RW objects in 0x2000+ range |

### Default Slave Config (`src/utils/ethercat/device-config-defaults.ts`)

`createDefaultSlaveConfig()` returns:
```typescript
{
  startupChecks: { checkVendorId: true, checkProductCode: true },
  addressing: { ethercatAddress: 0 },  // 0 = auto from position
  timeouts: { sdoTimeoutMs: 1000, initToPreOpTimeoutMs: 3000, safeOpToOpTimeoutMs: 10000 },
  watchdog: { smWatchdogEnabled: true, smWatchdogMs: 100, pdiWatchdogEnabled: false, ... },
  distributedClocks: { dcEnabled: false, dcSync0Enabled: false, ... },
}
```

---

## 8. Device Configuration (Per-Slave)

### Editor Components

```
src/renderer/components/_features/[workspace]/editor/device/ethercat/
├── index.tsx                          # Bus-level editor (3 tabs: Network, Repository, Advanced)
├── ethercat-device-editor.tsx         # Per-device editor (4 tabs below)
└── components/
    ├── scan-bus-tab.tsx               # Network scan + configured devices list
    ├── repository-tab.tsx             # ESI file management
    ├── advanced-tab.tsx               # Master config (cycle time, watchdog)
    ├── device-configuration-form.tsx  # Slave config forms (addressing, DC, watchdog)
    ├── channel-mapping-table.tsx      # IEC variable mapping table
    ├── sdo-parameters-table.tsx       # CoE SDO configuration table
    ├── device-browser-modal.tsx       # Modal for browsing ESI repo to add devices
    ├── interface-selector.tsx         # Network interface dropdown
    └── discovered-device-table.tsx    # Scan results table
```

### Per-Device Editor Tabs

1. **Device Info** — vendor, product code, revision, source, channel counts
2. **Configuration** — `DeviceConfigurationForm` with sections:
   - Addressing (EtherCAT address)
   - Timeouts (SDO, init→preop, safeop→op)
   - Watchdog (SM watchdog, PDI watchdog)
   - Distributed Clocks (DC sync0/sync1)
3. **Startup Parameters** — `SdoParametersSection`: editable CoE SDO entries
4. **Channel Mappings** — `ChannelMappingsSection`: IEC 61131-3 located variable assignments

### Channel Mapping Utilities (`src/utils/ethercat/esi-parser.ts`)

| Function | Purpose |
|----------|---------|
| `pdoToChannels(device)` | Flatten PDOs → `ESIChannel[]` (skips padding `0x0000`) |
| `generateIecLocation(channel, offset?)` | Generate `%IX0.0`, `%QW2`, etc. |
| `generateDefaultChannelMappings(channels, usedAddresses?)` | Auto-generate non-conflicting IEC addresses |
| `esiTypeToIecType(dataType, bitLen)` | Map ESI types → IEC types (BOOL, BYTE, WORD, ...) |

IEC location format:
```
%<direction><size><byte>.<bit>
  direction: I (input) or Q (output)
  size: X (bit), B (byte), W (word), D (dword), L (lword)
  Example: BOOL input at byte 0, bit 2 → %IX0.2
```

### SDO Extraction (`src/utils/ethercat/sdo-config-defaults.ts`)

`extractDefaultSdoConfigurations(coeObjects)` → `SDOConfigurationEntry[]`

- Filters CoE objects in range 0x2000+ (user-configurable)
- Excludes system objects (0x0000–0x1FFF)
- For complex objects: extracts RW sub-items with default values

### Device Configuration Hook (`src/renderer/hooks/use-device-configuration.ts`)

`useDeviceConfiguration({ device, projectPath, ... })` provides:
- Lazy-loads full ESI device on first render
- Manages channel list and CoE objects
- Handles alias changes in channel mappings
- Provides `updateConfig()` for slave config sections

---

## 9. State Management

### Zustand Store Slices

The EtherCAT state lives primarily in the **Project Slice** (`src/renderer/store/slices/project/slice.ts`):

```
project.data.remoteDevices[] → PLCRemoteDevice[]
  └── ethercatConfig
      ├── masterConfig: { networkInterface, cycleTimeUs, watchdogTimeoutCycles }
      └── devices: ConfiguredEtherCATDevice[]
```

Key actions on the project slice:

| Action | Purpose |
|--------|---------|
| `createRemoteDevice()` | Add bus + auto-create system task |
| `deleteRemoteDevice()` | Remove bus + delete system task |
| `updateEthercatConfig()` | Update master config and/or device list, sync task interval |
| `updateRemoteDeviceName()` | Rename bus + associated task |

The **Editor Slice** manages the active editor model:
- Bus editor: `type: 'plc-remote-device'`, `meta: { name, protocol: 'ethercat' }`
- Device editor: `type: 'plc-ethercat-device'`, `meta: { name, busName, deviceId }`

### EtherCAT Editor State (`src/renderer/components/.../ethercat/index.tsx`)

Local component state in `EtherCATEditor`:

```
Repository: ESIRepositoryItemLight[] (loaded from ESI service)
Interfaces: NetworkInterface[] (fetched from runtime)
Scan: scannedDevices[], deviceMatches[], selectedScannedDevices
Service: serviceAvailable, serviceMessage
```

Store-derived:
```
configuredDevices = remoteDevice.ethercatConfig.devices
masterConfig = remoteDevice.ethercatConfig.masterConfig
```

---

## 10. JSON Configuration Generation for Runtime

### Generator (`src/utils/ethercat/generate-ethercat-config.ts`)

`generateEthercatConfig(remoteDevices[])` → JSON string or `null`

Iterates all remote devices with `protocol === 'ethercat'`, produces:

```typescript
interface RuntimeRootEntry {
  name: string
  protocol: "ETHERCAT"
  config: {
    master: {
      interface: string          // "eth0"
      cycle_time_us: number
      watchdog_timeout_cycles: number
      task_name?: string         // "EtherCAT_Master1"
      task_cycle_time_us?: number
    }
    slaves: RuntimeSlave[]
    diagnostics: {
      log_connections: true
      log_data_access: false
      log_errors: true
      max_log_entries: 10000
      status_update_interval_ms: 500
    }
  }
}
```

Each slave:
```typescript
interface RuntimeSlave {
  position: number
  name: string
  type: string                   // "digital_input", "analog_output", etc.
  vendor_id: string              // "0x0002"
  product_code: string
  revision: string
  config: {
    startup_checks: { ... }
    addressing: { ethercat_address: number }
    timeouts: { ... }
    watchdog: { ... }
    distributed_clocks: { ... }
  }
  channels: RuntimeChannel[]     // { index, name, type, bit_length, iec_location, pdo refs }
  sdo_configurations: RuntimeSdoConfig[]
  rx_pdos: RuntimePdo[]          // Full PDO layout with padding
  tx_pdos: RuntimePdo[]
}
```

Channel type derivation: `deriveChannelType(direction, bitLen)` → `"digital_input"` | `"analog_input"` | `"digital_output"` | `"analog_output"`

SDO value parsing: `parseNumericValue(str)` handles decimal, hex (`0xFF`, `#xFF`), float, negative.

### Compiler Integration (`src/main/modules/compiler/compiler-module.ts`)

`handleGenerateEthercatConfig(sourceTargetFolderPath, projectData, handleOutputData)`:

1. Calls `generateEthercatConfig(projectData.remoteDevices)`
2. Creates `conf/` directory in firmware build folder
3. Writes `conf/ethercat.json`
4. Part of the larger build pipeline alongside `modbus-master.json`, `s7comm.json`, `opcua.json`

---

## 11. End-to-End Flow

```
1. CREATE BUS
   UI: Add Remote Device → protocol: ethercat
   Store: createRemoteDevice() → remoteDevices[] + system task

2. UPLOAD ESI FILES
   UI: Repository tab → drag & drop XML
   IPC: esiParseAndSaveFile() → main process → parseESILight()
   Disk: devices/esi/<uuid>.xml + repository.json

3. SCAN NETWORK (online) or ADD MANUALLY (offline)
   Online:
     IPC: etherCATScan() → runtime HTTP → EtherCATScanResponse
     Match: matchDevicesToRepository() → exact/partial/none
     Select: user picks matched devices → handleAddSelectedFromScan()
   Offline:
     UI: + button → DeviceBrowserModal → select from repository
     Handler: handleAddDeviceFromBrowser()

4. ENRICH & STORE
   IPC: esiLoadDeviceFull() → parseESIDeviceFull()
   Util: enrichDeviceData() → channelInfo, PDOs, slaveType, SDOs
   Store: updateEthercatConfig() → devices[] + sync task interval

5. CONFIGURE DEVICE
   UI: Click device in tree → EtherCATDeviceEditor
   Tabs: Config (addressing, DC, watchdog), SDO params, Channel mappings
   Store: updateEthercatConfig() on each change

6. BUILD FIRMWARE
   Compiler: generateEthercatConfig(remoteDevices)
   Output: conf/ethercat.json
   Runtime: loads JSON → initializes master/slaves → starts cyclic task
```

---

## 12. File Reference

### Types
| File | Contents |
|------|----------|
| `src/types/ethercat/esi-types.ts` | ESIDevice, ConfiguredEtherCATDevice, channels, PDOs, SDOs |
| `src/types/ethercat/index.ts` | EtherCATDevice, scan/status responses, NetworkInterface |
| `src/types/PLC/open-plc.ts` | Zod schemas: EthercatConfig, EtherCATMasterConfig, PLCRemoteDevice |

### Main Process
| File | Contents |
|------|----------|
| `src/main/services/esi-service/index.ts` | ESI file persistence and repository management |
| `src/main/services/esi-service/esi-parser-main.ts` | XML parsing (light and full modes) |
| `src/main/modules/ipc/main.ts` | IPC handlers for scan, status, ESI operations |
| `src/main/modules/ipc/renderer.ts` | Renderer-side IPC bridge (`window.bridge.*`) |
| `src/main/modules/compiler/compiler-module.ts` | Firmware build: writes `conf/ethercat.json` |

### Renderer — Utilities
| File | Contents |
|------|----------|
| `src/utils/ethercat/device-matcher.ts` | Match scanned devices against ESI repository |
| `src/utils/ethercat/enrich-device-data.ts` | Extract persistable data from full ESI device |
| `src/utils/ethercat/esi-parser.ts` | pdoToChannels, generateIecLocation, default mappings |
| `src/utils/ethercat/device-config-defaults.ts` | DEFAULT_SLAVE_CONFIG |
| `src/utils/ethercat/sdo-config-defaults.ts` | Extract default SDO configurations from CoE |
| `src/utils/ethercat/ethercat-task-helpers.ts` | Task naming, cycle time conversion |
| `src/utils/ethercat/generate-ethercat-config.ts` | Generate runtime JSON from project state |

### Renderer — Components
| File | Contents |
|------|----------|
| `src/renderer/components/.../ethercat/index.tsx` | Bus-level editor (Network, Repository, Advanced tabs) |
| `src/renderer/components/.../ethercat/ethercat-device-editor.tsx` | Per-device editor (Info, Config, SDO, Channels tabs) |
| `src/renderer/components/.../ethercat/components/scan-bus-tab.tsx` | Scan UI + configured devices list with +/- |
| `src/renderer/components/.../ethercat/components/device-browser-modal.tsx` | Browse ESI repo to add devices |
| `src/renderer/components/.../ethercat/components/device-configuration-form.tsx` | Slave config forms |
| `src/renderer/components/.../ethercat/components/channel-mapping-table.tsx` | IEC variable mapping |
| `src/renderer/components/.../ethercat/components/sdo-parameters-table.tsx` | CoE SDO editing |

### Renderer — Store
| File | Contents |
|------|----------|
| `src/renderer/store/slices/project/slice.ts` | createRemoteDevice, updateEthercatConfig, delete, rename |
| `src/renderer/store/slices/editor/types.ts` | Editor model schema (plc-ethercat-device variant) |
| `src/renderer/store/slices/tabs/utils.ts` | CreateEtherCATDeviceEditor |
| `src/renderer/store/slices/shared/index.ts` | openFile, closeFile, forceCloseFile, deleteEthercatDevice |
| `src/renderer/hooks/use-device-configuration.ts` | Lazy-load full device, manage channels/SDOs |

---

## 13. Constraints & Notes

1. **ESI parsing is CPU-bound** — runs in main process. Sequential uploads recommended for UI responsiveness.
2. **Cycle time ↔ task sync** — `updateEthercatConfig()` auto-updates the associated system task interval.
3. **Address uniqueness** — IEC addresses must be unique across all remote devices (Modbus + EtherCAT). `usedAddresses` is tracked when generating mappings.
4. **CoE SDO range** — only objects in 0x2000+ are user-configurable. System objects (0x0000–0x1FFF) are runtime-managed.
5. **PDO padding** — entries with `index: "0x0000"` are padding: excluded from channel lists but preserved in persisted PDOs for correct byte offsets.
6. **System tasks** — auto-created on device creation, auto-deleted on removal. Marked with `isSystemTask: true`.
7. **Repository v2 migration** — old v1 (metadata-only) auto-migrates to v2 (with device summaries) on first load.
8. **Editor caching** — editor models are cached by `meta.name`. When removing a device, its tab/editor must be explicitly closed to avoid stale `deviceId` references on re-add.
