# OPC-UA Server Configuration - Implementation Phases

This document outlines a phased approach to implementing the OPC-UA server configuration feature in OpenPLC Editor.

## Overview

The implementation is divided into 6 phases, designed to deliver incremental functionality while managing complexity:

| Phase | Focus | Deliverable |
|-------|-------|-------------|
| 1 | Foundation & Types | Type definitions, project integration, basic UI shell |
| 2 | General Settings & Security Profiles | First two tabs fully functional |
| 3 | Users & Certificates | Authentication and certificate management |
| 4 | Address Space - Basic Variables | Variable tree and simple variable selection |
| 5 | Address Space - Complex Types | Structures, arrays, nested FBs |
| 6 | Compiler Integration & Testing | JSON generation, end-to-end testing |

---

## Phase 1: Foundation & Type Definitions

### Objective
Establish the foundational type system and basic UI infrastructure for OPC-UA configuration.

### Deliverables

#### 1.1 Type Definitions

**File:** `src/types/PLC/open-plc.ts`

Add Zod schemas for all OPC-UA configuration types:

```typescript
// Security Profile Schema
const OpcUaSecurityProfileSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(64),
  enabled: z.boolean(),
  securityPolicy: z.enum(['None', 'Basic128Rsa15', 'Basic256', 'Basic256Sha256']),
  securityMode: z.enum(['None', 'Sign', 'SignAndEncrypt']),
  authMethods: z.array(z.enum(['Anonymous', 'Username', 'Certificate'])).min(1),
})

// Trusted Certificate Schema
const OpcUaTrustedCertificateSchema = z.object({
  id: z.string().min(1).max(64),
  pem: z.string(),
  subject: z.string().optional(),
  validFrom: z.string().optional(),
  validTo: z.string().optional(),
  fingerprint: z.string().optional(),
})

// User Schema
const OpcUaUserSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['password', 'certificate']),
  username: z.string().nullable(),
  passwordHash: z.string().nullable(),
  certificateId: z.string().nullable(),
  role: z.enum(['viewer', 'operator', 'engineer']),
})

// Permissions Schema
const OpcUaPermissionsSchema = z.object({
  viewer: z.enum(['r', 'w', 'rw']).default('r'),
  operator: z.enum(['r', 'w', 'rw']).default('r'),
  engineer: z.enum(['r', 'w', 'rw']).default('rw'),
})

// Field Configuration Schema (for structures)
const OpcUaFieldConfigSchema = z.object({
  fieldPath: z.string(),
  displayName: z.string(),
  initialValue: z.union([z.boolean(), z.number(), z.string()]),
  permissions: OpcUaPermissionsSchema,
})

// Node Configuration Schema
const OpcUaNodeConfigSchema = z.object({
  id: z.string().uuid(),
  pouName: z.string(),
  variablePath: z.string(),
  variableType: z.string(),
  nodeId: z.string(),
  browseName: z.string(),
  displayName: z.string(),
  description: z.string().default(''),
  initialValue: z.union([z.boolean(), z.number(), z.string()]),
  permissions: OpcUaPermissionsSchema,
  nodeType: z.enum(['variable', 'structure', 'array']),
  fields: z.array(OpcUaFieldConfigSchema).optional(),
  arrayLength: z.number().optional(),
  elementType: z.string().optional(),
})

// Complete Server Configuration Schema
const OpcUaServerConfigSchema = z.object({
  server: z.object({
    enabled: z.boolean().default(false),
    name: z.string().max(128).default('OpenPLC OPC UA Server'),
    applicationUri: z.string().default('urn:openplc:opcua:server'),
    productUri: z.string().default('urn:openplc:runtime'),
    bindAddress: z.string().default('0.0.0.0'),
    port: z.number().int().min(1).max(65535).default(4840),
    endpointPath: z.string().default('/openplc/opcua'),
  }),
  securityProfiles: z.array(OpcUaSecurityProfileSchema).default([]),
  security: z.object({
    serverCertificateStrategy: z.enum(['auto_self_signed', 'custom']).default('auto_self_signed'),
    serverCertificateCustom: z.string().nullable().default(null),
    serverPrivateKeyCustom: z.string().nullable().default(null),
    trustedClientCertificates: z.array(OpcUaTrustedCertificateSchema).default([]),
  }),
  users: z.array(OpcUaUserSchema).default([]),
  cycleTimeMs: z.number().int().min(10).max(10000).default(100),
  addressSpace: z.object({
    namespaceUri: z.string().default('urn:openplc:opcua:namespace'),
    nodes: z.array(OpcUaNodeConfigSchema).default([]),
  }),
})
```

#### 1.2 Protocol Extension

**File:** `src/types/PLC/open-plc.ts`

Add 'opcua' to the PLCServer protocol union:

```typescript
const PLCServerSchema = z.object({
  name: z.string(),
  protocol: z.enum(['modbus-tcp', 's7comm', 'ethernet-ip', 'opcua']),
  modbusSlaveConfig: ModbusSlaveConfigSchema.optional(),
  s7commSlaveConfig: S7CommSlaveConfigSchema.optional(),
  opcuaServerConfig: OpcUaServerConfigSchema.optional(),  // Add this
})
```

#### 1.3 Project Slice Actions

**File:** `src/renderer/store/slices/project/slice.ts`

Add basic CRUD actions for OPC-UA configuration:

```typescript
// OPC-UA Server Actions
createOpcUaServer: (serverName: string) => void
updateOpcUaServerSettings: (serverName: string, settings: Partial<OpcUaServerSettings>) => void
deleteOpcUaServer: (serverName: string) => void
```

#### 1.4 UI Shell Component

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/index.tsx`

Create the basic tabbed UI structure:

```tsx
const OpcUaServerEditor = () => {
  const [activeTab, setActiveTab] = useState<string>('general')

  const tabs = [
    { id: 'general', label: 'General Settings' },
    { id: 'security', label: 'Security Profiles' },
    { id: 'users', label: 'Users' },
    { id: 'certificates', label: 'Certificates' },
    { id: 'address-space', label: 'Address Space' },
  ]

  return (
    <div className="flex flex-col h-full">
      <TabsComponent tabs={tabs} active={activeTab} onChange={setActiveTab} />
      <div className="flex-1 overflow-auto p-4">
        {activeTab === 'general' && <GeneralSettingsTab />}
        {activeTab === 'security' && <SecurityProfilesTab />}
        {activeTab === 'users' && <UsersTab />}
        {activeTab === 'certificates' && <CertificatesTab />}
        {activeTab === 'address-space' && <AddressSpaceTab />}
      </div>
    </div>
  )
}
```

### Acceptance Criteria

- [ ] All Zod schemas defined and exported
- [ ] PLCServer type updated with opcuaServerConfig
- [ ] Basic project slice actions implemented
- [ ] Tabbed UI component renders with placeholder content
- [ ] OPC-UA server can be created/deleted from Servers panel

---

## Phase 2: General Settings & Security Profiles

### Objective
Implement the first two configuration tabs with full functionality.

### Deliverables

#### 2.1 General Settings Tab

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/tabs/general-settings.tsx`

Implement all fields:
- Enable toggle
- Server name
- Application URI
- Product URI
- Bind address (dropdown with common options)
- Port number
- Endpoint path
- Cycle time with validation

```tsx
const GeneralSettingsTab = () => {
  const { project, projectActions } = useOpenPLCStore()
  const opcuaConfig = getOpcUaConfig(project)

  const handleUpdateServer = (updates: Partial<OpcUaServerSettings>) => {
    projectActions.updateOpcUaServerSettings(serverName, updates)
  }

  return (
    <div className="space-y-6">
      {/* Enable Toggle */}
      <div className="flex items-center justify-between">
        <label>Enable OPC-UA Server</label>
        <Switch
          checked={opcuaConfig.server.enabled}
          onCheckedChange={(enabled) => handleUpdateServer({ enabled })}
        />
      </div>

      {/* Server Identity Section */}
      <section>
        <h3>Server Identity</h3>
        {/* Form fields */}
      </section>

      {/* Network Configuration Section */}
      <section>
        <h3>Network Configuration</h3>
        {/* Form fields with endpoint URL preview */}
      </section>

      {/* Performance Section */}
      <section>
        <h3>Performance</h3>
        {/* Cycle time input */}
      </section>
    </div>
  )
}
```

#### 2.2 Security Profiles Tab

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/tabs/security-profiles.tsx`

Implement:
- List of security profiles with enable/disable toggle
- Add/Edit/Delete profile functionality
- Profile modal with all settings
- Validation rules (Anonymous only with None policy, etc.)

#### 2.3 Security Profile Modal

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/security-profile-modal.tsx`

Implement modal with:
- Profile name input
- Enable toggle
- Security policy dropdown
- Security mode dropdown
- Authentication methods checkboxes
- Validation feedback

#### 2.4 Project Slice Actions

Add actions for security profile management:

```typescript
addOpcUaSecurityProfile: (serverName: string, profile: OpcUaSecurityProfile) => void
updateOpcUaSecurityProfile: (serverName: string, profileId: string, updates: Partial<OpcUaSecurityProfile>) => void
removeOpcUaSecurityProfile: (serverName: string, profileId: string) => void
```

### Acceptance Criteria

- [ ] General settings tab saves all fields correctly
- [ ] Endpoint URL preview updates dynamically
- [ ] Cycle time validates range (10-10000)
- [ ] Security profiles can be added/edited/removed
- [ ] At least one profile must be enabled (validation)
- [ ] Anonymous auth only available with None policy
- [ ] Profile list shows summary of each profile

---

## Phase 3: Users & Certificates

### Objective
Implement user authentication and certificate management.

### Deliverables

#### 3.1 Users Tab

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/tabs/users.tsx`

Implement:
- User list with role badges
- Add/Edit/Delete user functionality
- User type toggle (password/certificate)
- Password validation and hashing

#### 3.2 User Modal

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/user-modal.tsx`

Implement:
- Authentication type selector
- Password fields with strength indicator
- Certificate selector (from trusted certificates)
- Role selector with descriptions

#### 3.3 Password Hashing Utility

**File:** `src/utils/opcua/bcrypt-utils.ts`

```typescript
import bcrypt from 'bcryptjs'

export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(12)
  return bcrypt.hash(password, salt)
}

export const verifyPassword = async (
  password: string,
  hash: string
): Promise<boolean> => {
  return bcrypt.compare(password, hash)
}
```

#### 3.4 Certificates Tab

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/tabs/certificates.tsx`

Implement:
- Server certificate strategy selector
- Custom certificate upload (when strategy = custom)
- Private key upload
- Trusted client certificates list
- Certificate details display

#### 3.5 Certificate Parsing Utility

**File:** `src/utils/opcua/certificate-utils.ts`

Use a library like `node-forge` to parse PEM certificates:

```typescript
import forge from 'node-forge'

export interface CertificateInfo {
  subject: string
  issuer: string
  validFrom: Date
  validTo: Date
  fingerprint: string
}

export const parsePemCertificate = (pem: string): CertificateInfo => {
  const cert = forge.pki.certificateFromPem(pem)
  return {
    subject: cert.subject.getField('CN')?.value || 'Unknown',
    issuer: cert.issuer.getField('CN')?.value || 'Unknown',
    validFrom: cert.validity.notBefore,
    validTo: cert.validity.notAfter,
    fingerprint: forge.md.sha256
      .create()
      .update(forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes())
      .digest()
      .toHex(),
  }
}
```

#### 3.6 Add Trusted Certificate Modal

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/certificate-modal.tsx`

Implement:
- Certificate ID input
- PEM content text area
- File browse button
- Certificate details preview (parsed from PEM)

### Acceptance Criteria

- [ ] Password users can be created with bcrypt hashing
- [ ] Certificate users can be created referencing trusted certs
- [ ] At least one user required when Username auth enabled
- [ ] Server certificate strategy works (auto/custom)
- [ ] Custom certificates can be uploaded via file or paste
- [ ] Trusted certificates show parsed details (subject, validity)
- [ ] Certificate IDs are unique

---

## Phase 4: Address Space - Basic Variables

### Objective
Implement the variable tree and basic variable selection functionality.

### Deliverables

#### 4.1 Address Space Tab

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/tabs/address-space.tsx`

Implement:
- Namespace URI input
- Split-pane layout (available variables | selected variables)
- Add/Remove buttons
- Filter input for variable search

#### 4.2 Variable Tree Component

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/variable-tree.tsx`

Build the hierarchical variable tree from project POUs:

```tsx
interface TreeNode {
  id: string
  name: string
  type: 'program' | 'function_block' | 'global' | 'variable' | 'structure' | 'array'
  variableType?: string  // IEC type for variables
  children?: TreeNode[]
  pouName: string
  variablePath: string
  isSelectable: boolean
  isExpanded?: boolean
}

const VariableTree = ({
  nodes,
  selectedIds,
  onSelect,
  onExpand,
}: VariableTreeProps) => {
  const renderNode = (node: TreeNode, depth: number) => (
    <div key={node.id} style={{ paddingLeft: depth * 16 }}>
      <div className="flex items-center gap-2">
        {node.children && (
          <ExpandIcon
            expanded={node.isExpanded}
            onClick={() => onExpand(node.id)}
          />
        )}
        {node.isSelectable && (
          <Checkbox
            checked={selectedIds.has(node.id)}
            onChange={() => onSelect(node)}
          />
        )}
        <NodeIcon type={node.type} />
        <span>{node.name}</span>
        {node.variableType && (
          <span className="text-muted">({node.variableType})</span>
        )}
      </div>
      {node.isExpanded && node.children?.map(child =>
        renderNode(child, depth + 1)
      )}
    </div>
  )

  return <div>{nodes.map(node => renderNode(node, 0))}</div>
}
```

#### 4.3 Variable Extraction from Project

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/hooks/use-project-variables.ts`

Extract variables from project POUs:

```typescript
const useProjectVariables = (): TreeNode[] => {
  const { project } = useOpenPLCStore()

  return useMemo(() => {
    const nodes: TreeNode[] = []

    // Programs and Function Block instances
    for (const pou of project.data.pous) {
      if (pou.type === 'program') {
        nodes.push(buildProgramNode(pou, project.data))
      }
    }

    // Global Variables
    if (project.data.globalVariables?.length) {
      nodes.push(buildGlobalVariablesNode(project.data.globalVariables))
    }

    return nodes
  }, [project.data])
}

const buildProgramNode = (pou: POU, projectData: PLCProjectData): TreeNode => {
  return {
    id: `pou-${pou.data.name}`,
    name: pou.data.name,
    type: 'program',
    pouName: pou.data.name,
    variablePath: '',
    isSelectable: false,
    children: pou.data.variables.map(v =>
      buildVariableNode(v, pou.data.name, projectData)
    ),
  }
}
```

#### 4.4 Simple Variable Configuration Modal

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/variable-config-modal.tsx`

Implement modal for configuring selected variables:
- Node ID (auto-generated, editable)
- Browse name
- Display name
- Description
- Initial value (type-appropriate input)
- Permissions matrix

#### 4.5 Selected Variables List

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/selected-variables-list.tsx`

Display selected variables with:
- Node summary (node ID, type, permissions)
- Edit/Remove buttons
- Drag-and-drop reordering

### Acceptance Criteria

- [ ] Variable tree displays all program variables
- [ ] Tree supports expand/collapse for nested items
- [ ] Simple variables (INT, BOOL, REAL, etc.) can be selected
- [ ] Selected variables appear in right panel
- [ ] Variables can be configured with OPC-UA properties
- [ ] Node IDs are auto-generated but editable
- [ ] Permissions can be set per variable
- [ ] Variables can be removed from selection

---

## Phase 5: Address Space - Complex Types

### Objective
Add support for structures, arrays, and deeply nested function blocks.

### Deliverables

#### 5.1 Structure Support

Extend the variable tree to show structure fields:

```typescript
const buildStructureNode = (
  variable: Variable,
  pouName: string,
  structType: StructType
): TreeNode => {
  return {
    id: `${pouName}-${variable.name}`,
    name: variable.name,
    type: 'structure',
    variableType: variable.type.value,
    pouName,
    variablePath: variable.name,
    isSelectable: true,  // Can select entire structure
    children: structType.variable.map(field => ({
      id: `${pouName}-${variable.name}-${field.name}`,
      name: field.name,
      type: 'variable',
      variableType: field.type.value,
      pouName,
      variablePath: `${variable.name}.${field.name}`,
      isSelectable: true,  // Or select individual fields
    })),
  }
}
```

#### 5.2 Structure Configuration Modal

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/structure-config-modal.tsx`

Implement modal for structure configuration:
- Structure-level properties (node ID, browse name, etc.)
- Field table with individual permissions
- Nested structure handling

#### 5.3 Array Support

Extend the variable tree for arrays:

```typescript
const buildArrayNode = (
  variable: Variable,
  pouName: string,
  arrayDimension: string  // e.g., "1..10"
): TreeNode => {
  const [min, max] = arrayDimension.split('..').map(Number)
  const length = max - min + 1

  return {
    id: `${pouName}-${variable.name}`,
    name: variable.name,
    type: 'array',
    variableType: `ARRAY[${arrayDimension}] OF ${elementType}`,
    pouName,
    variablePath: variable.name,
    isSelectable: true,
    children: Array.from({ length }, (_, i) => ({
      id: `${pouName}-${variable.name}-${min + i}`,
      name: `[${min + i}]`,
      type: 'variable',
      variableType: elementType,
      pouName,
      variablePath: `${variable.name}[${min + i}]`,
      isSelectable: true,
    })),
  }
}
```

#### 5.4 Array Configuration Modal

**File:** `src/renderer/components/_features/[workspace]/editor/server/opcua-server/components/array-config-modal.tsx`

Implement modal for array configuration:
- Array-level properties
- Element type display
- Length display
- Permissions (apply to all elements)

#### 5.5 Nested Function Block Support

Handle deeply nested FB instances:

```typescript
const buildFunctionBlockNode = (
  variable: Variable,
  pouName: string,
  fbType: FunctionBlock,
  projectData: PLCProjectData,
  currentPath: string = ''
): TreeNode => {
  const variablePath = currentPath
    ? `${currentPath}.${variable.name}`
    : variable.name

  return {
    id: `${pouName}-${variablePath}`,
    name: variable.name,
    type: 'function_block',
    variableType: variable.type.value,
    pouName,
    variablePath,
    isSelectable: true,  // Select entire FB
    children: fbType.variable.map(fbVar => {
      // Check if this FB variable is itself an FB
      const nestedFbType = findFunctionBlock(fbVar.type.value, projectData)

      if (nestedFbType) {
        // Recursive: nested FB
        return buildFunctionBlockNode(
          fbVar,
          pouName,
          nestedFbType,
          projectData,
          variablePath
        )
      }

      // Leaf: simple variable
      return {
        id: `${pouName}-${variablePath}-${fbVar.name}`,
        name: fbVar.name,
        type: 'variable',
        variableType: fbVar.type.value,
        pouName,
        variablePath: `${variablePath}.${fbVar.name}`,
        isSelectable: true,
      }
    }),
  }
}
```

#### 5.6 Selection Behavior for Complex Types

Implement selection logic:

```typescript
const handleSelectNode = (node: TreeNode) => {
  if (node.type === 'variable') {
    // Simple toggle
    toggleSelection(node.id)
  } else {
    // Complex type: select/deselect all children
    const childIds = getAllChildIds(node)
    if (allSelected(childIds)) {
      deselectAll(childIds)
    } else {
      selectAll(childIds)
    }
  }
}
```

#### 5.7 Deeply Nested Path Display

Show full path in selected variables list:

```
main:PROCESS_CTRL.HEATER.PID.OUTPUT
         └── FB ──┘ └─ FB ─┘ └─ var
```

### Acceptance Criteria

- [ ] Structures display with expandable fields
- [ ] Entire structure or individual fields can be selected
- [ ] Arrays display with expandable elements
- [ ] Entire array can be selected (not individual elements for now)
- [ ] Nested FBs display correctly (FB inside FB inside FB)
- [ ] All levels of nesting are navigable
- [ ] Selection of parent auto-selects all children
- [ ] Path display shows full hierarchy

---

## Phase 6: Compiler Integration & Testing

### Objective
Integrate OPC-UA JSON generation into the compiler and perform end-to-end testing.

### Deliverables

#### 6.1 JSON Generator Implementation

**File:** `src/utils/opcua/generate-opcua-config.ts`

Implement the complete generator as documented in `03-json-configuration-mapping.md`:

```typescript
export const generateOpcUaConfig = (
  servers: PLCServer[] | undefined,
  debugFileContent: string
): string | null => {
  // Implementation as documented
}
```

#### 6.2 Index Resolution Implementation

**File:** `src/utils/opcua/resolve-indices.ts`

Implement index resolution logic:

```typescript
export const resolveVariableIndex = (
  pouName: string,
  variablePath: string,
  debugVariables: DebugVariable[]
): number => {
  // Build debug path based on variable type
  // Match against parsed debug.c
  // Return index or throw error
}
```

#### 6.3 Compiler Module Integration

**File:** `src/main/modules/compiler/compiler-module.ts`

Add OPC-UA configuration generation to the compilation pipeline:

```typescript
import { generateOpcUaConfig } from '@root/utils/opcua'

// In the compile method, after debug.c is generated:
async handleGenerateOpcUaConfig(
  sourceTargetFolderPath: string,
  projectData: PLCProjectData
): Promise<void> {
  const opcuaServer = projectData.servers?.find(
    s => s.protocol === 'opcua' && s.opcuaServerConfig?.server.enabled
  )

  if (!opcuaServer) return

  const debugCPath = join(sourceTargetFolderPath, 'debug.c')
  const debugContent = await readFile(debugCPath, 'utf-8')

  const opcuaJson = generateOpcUaConfig(projectData.servers, debugContent)

  if (opcuaJson) {
    const confDir = join(sourceTargetFolderPath, 'conf')
    await mkdir(confDir, { recursive: true })
    await writeFile(join(confDir, 'opcua.json'), opcuaJson, 'utf-8')
  }
}
```

#### 6.4 Error Handling & User Feedback

Implement error handling for common issues:

- Variable not found in debug.c
- Invalid configuration (no enabled profiles, no users, etc.)
- Circular references in FB structures

```typescript
export class OpcUaConfigError extends Error {
  constructor(
    public code: 'VARIABLE_NOT_FOUND' | 'INVALID_CONFIG' | 'CIRCULAR_REF',
    public details: Record<string, string>,
    message: string
  ) {
    super(message)
  }
}
```

#### 6.5 Unit Tests

**File:** `src/utils/opcua/__tests__/generate-opcua-config.test.ts`

Write comprehensive tests:

```typescript
describe('generateOpcUaConfig', () => {
  it('returns null when OPC-UA not configured', () => {
    // Test
  })

  it('generates valid JSON for simple variables', () => {
    // Test
  })

  it('resolves structure field indices correctly', () => {
    // Test
  })

  it('resolves array start indices correctly', () => {
    // Test
  })

  it('handles nested FB paths correctly', () => {
    // Test
  })

  it('throws error for unresolvable variables', () => {
    // Test
  })
})
```

#### 6.6 Integration Tests

**File:** `e2e/opcua-configuration.spec.ts`

Write end-to-end tests:

```typescript
test('OPC-UA server can be configured and compiled', async ({ page }) => {
  // 1. Create new project
  // 2. Add program with variables
  // 3. Configure OPC-UA server
  // 4. Select variables for address space
  // 5. Compile project
  // 6. Verify opcua.json is generated correctly
})
```

#### 6.7 Documentation Updates

Update user documentation:
- How to configure OPC-UA server
- Security best practices
- Troubleshooting guide

### Acceptance Criteria

- [ ] JSON generator produces valid output
- [ ] Index resolution works for all variable types
- [ ] Compiler generates opcua.json when OPC-UA enabled
- [ ] Errors provide helpful messages
- [ ] Unit tests pass with >80% coverage
- [ ] E2E tests pass
- [ ] Generated JSON validated against runtime plugin

---

## Summary Timeline

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 1 | Foundation & Types | None |
| 2 | General Settings & Security | Phase 1 |
| 3 | Users & Certificates | Phase 2 |
| 4 | Address Space - Basic | Phase 1 |
| 5 | Address Space - Complex | Phase 4 |
| 6 | Compiler Integration | Phases 1-5 |

**Parallel Work Opportunities:**
- Phases 2-3 (Security/Users) can be developed in parallel with Phases 4-5 (Address Space)
- Unit tests can be written alongside each phase

---

## Risk Mitigation

### Technical Risks

| Risk | Mitigation |
|------|------------|
| Complex nested FB paths | Reuse debugger's proven path building logic |
| Password security | Use bcryptjs, never store plain text |
| Certificate parsing errors | Validate PEM format before storing |
| Large variable trees | Implement tree virtualization |

### Integration Risks

| Risk | Mitigation |
|------|------------|
| Index resolution failures | Comprehensive error messages with expected path |
| Runtime incompatibility | Test against actual OPC-UA plugin during development |
| Project file migration | Provide default values for new fields |

---

## Dependencies

### External Libraries

| Library | Purpose | Phase |
|---------|---------|-------|
| bcryptjs | Password hashing | 3 |
| node-forge | Certificate parsing | 3 |
| react-window | Tree virtualization | 4 |
| uuid | Generate unique IDs | 1 |

### Internal Dependencies

| Component | Purpose | Phase |
|-----------|---------|-------|
| parseDebugFile | Index resolution | 6 |
| Project store | State management | 1 |
| Compiler module | JSON generation | 6 |
