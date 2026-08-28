import { XmlGenerator } from '../../../../../backend/shared/utils/PLC/xml-generator'
import type { PLCProjectData } from '../../../../../middleware/shared/ports/open-plc-types'
import { parsePlcopenXml } from '../index'

// ---------------------------------------------------------------------------
// Round-trip fixture: one program per language (ST, IL, LD, FBD), one data
// type per derivation, plus a task/instance/global-variable configuration.
// Built directly against the nested `PLCPou` shape `XmlGenerator` consumes
// (middleware/shared/ports/open-plc-types.ts) — the flat shape produced by
// `parsePlcopenXml` is a different (newer) representation, so equivalence is
// asserted field-by-field below rather than via a single deep-equal.
// ---------------------------------------------------------------------------

const outHandle = {
  id: 'output-variable',
  type: 'source' as const,
  position: 'right' as const,
  glbPosition: { x: 80, y: 15 },
  relPosition: { x: 80, y: 15 },
}
const inHandle = {
  id: 'input-variable',
  type: 'target' as const,
  position: 'left' as const,
  glbPosition: { x: 200, y: 15 },
  relPosition: { x: 0, y: 15 },
}

const fbdRung = {
  comment: '',
  selectedNodes: [],
  nodes: [
    {
      id: 'iv1',
      type: 'input-variable',
      position: { x: 0, y: 0 },
      width: 80,
      height: 30,
      data: {
        numericId: '1',
        executionOrder: 0,
        negated: false,
        variable: { name: 'X1' },
        handles: [outHandle],
        inputHandles: [],
        outputHandles: [outHandle],
        outputConnector: outHandle,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'input-variable',
      },
    },
    {
      id: 'ov1',
      type: 'output-variable',
      position: { x: 200, y: 0 },
      width: 80,
      height: 30,
      data: {
        numericId: '2',
        executionOrder: 1,
        negated: false,
        variable: { name: 'Y1' },
        handles: [inHandle],
        inputHandles: [inHandle],
        outputHandles: [],
        inputConnector: inHandle,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'output-variable',
      },
    },
  ],
  edges: [
    {
      id: 'e1',
      source: 'iv1',
      sourceHandle: 'output-variable',
      target: 'ov1',
      targetHandle: 'input-variable',
      type: 'smoothstep',
    },
  ],
}

const railOutHandle = {
  id: 'left-rail',
  type: 'source' as const,
  position: 'right' as const,
  glbPosition: { x: 20, y: 20 },
  relPosition: { x: 20, y: 20 },
}
const contactInHandle = {
  id: 'input',
  type: 'target' as const,
  position: 'left' as const,
  glbPosition: { x: 50, y: 20 },
  relPosition: { x: 0, y: 20 },
}
const contactOutHandle = {
  id: 'output',
  type: 'source' as const,
  position: 'right' as const,
  glbPosition: { x: 90, y: 20 },
  relPosition: { x: 40, y: 20 },
}
const coilInHandle = {
  id: 'input',
  type: 'target' as const,
  position: 'left' as const,
  glbPosition: { x: 100, y: 20 },
  relPosition: { x: 0, y: 20 },
}
const coilOutHandle = {
  id: 'output',
  type: 'source' as const,
  position: 'right' as const,
  glbPosition: { x: 140, y: 20 },
  relPosition: { x: 40, y: 20 },
}
const railInHandle = {
  id: 'right-rail',
  type: 'target' as const,
  position: 'left' as const,
  glbPosition: { x: 150, y: 20 },
  relPosition: { x: 0, y: 20 },
}

const ladderRung = {
  id: 'rung-0',
  comment: '',
  defaultBounds: [0, 0, 170, 40],
  reactFlowViewport: [170, 40],
  selectedNodes: [],
  nodes: [
    {
      id: 'lr1',
      type: 'powerRail',
      position: { x: 0, y: 0 },
      width: 20,
      height: 40,
      data: {
        numericId: '1',
        variable: { name: '' },
        executionOrder: 0,
        handles: [railOutHandle],
        inputHandles: [],
        outputHandles: [railOutHandle],
        outputConnector: railOutHandle,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'left',
      },
    },
    {
      id: 'c1',
      type: 'contact',
      position: { x: 50, y: 0 },
      width: 40,
      height: 40,
      data: {
        numericId: '2',
        variable: { name: 'X1' },
        executionOrder: 0,
        handles: [contactInHandle, contactOutHandle],
        inputHandles: [contactInHandle],
        outputHandles: [contactOutHandle],
        inputConnector: contactInHandle,
        outputConnector: contactOutHandle,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'default',
      },
    },
    {
      id: 'co1',
      type: 'coil',
      position: { x: 100, y: 0 },
      width: 40,
      height: 40,
      data: {
        numericId: '3',
        variable: { name: 'Y1' },
        executionOrder: 0,
        handles: [coilInHandle, coilOutHandle],
        inputHandles: [coilInHandle],
        outputHandles: [coilOutHandle],
        inputConnector: coilInHandle,
        outputConnector: coilOutHandle,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'default',
      },
    },
    {
      id: 'rr1',
      type: 'powerRail',
      position: { x: 150, y: 0 },
      width: 20,
      height: 40,
      data: {
        numericId: '4',
        variable: { name: '' },
        executionOrder: 0,
        handles: [railInHandle],
        inputHandles: [railInHandle],
        outputHandles: [],
        inputConnector: railInHandle,
        draggable: true,
        selectable: true,
        deletable: true,
        variant: 'right',
      },
    },
  ],
  edges: [
    { id: 'e1', source: 'lr1', sourceHandle: 'left-rail', target: 'c1', targetHandle: 'input', type: 'smoothstep' },
    { id: 'e2', source: 'c1', sourceHandle: 'output', target: 'co1', targetHandle: 'input', type: 'smoothstep' },
    { id: 'e3', source: 'co1', sourceHandle: 'output', target: 'rr1', targetHandle: 'right-rail', type: 'smoothstep' },
  ],
}

function makeFixture(): PLCProjectData {
  return {
    dataTypes: [
      {
        name: 'MyStruct',
        derivation: 'structure',
        variable: [{ name: 'flag', type: { definition: 'base-type', value: 'BOOL' } }],
      },
      {
        name: 'MyEnum',
        derivation: 'enumerated',
        initialValue: 'RED',
        values: [{ description: 'RED' }, { description: 'GREEN' }],
      },
      {
        name: 'MyArray',
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'INT' },
        initialValue: '0',
        dimensions: [{ dimension: '0..9' }],
      },
    ],
    pous: [
      {
        type: 'program',
        data: {
          name: 'mainSt',
          language: 'st',
          variables: [
            {
              name: 'a',
              class: 'input',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'st', value: 'a := TRUE;' },
          documentation: 'ST program',
        },
      },
      {
        type: 'function-block',
        data: {
          name: 'mainIl',
          language: 'il',
          variables: [
            {
              name: 'b',
              class: 'local',
              type: { definition: 'base-type', value: 'INT' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'il', value: 'LD 1' },
          documentation: '',
        },
      },
      {
        type: 'program',
        data: {
          name: 'mainLd',
          language: 'ld',
          variables: [
            {
              name: 'X1',
              class: 'input',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
            {
              name: 'Y1',
              class: 'output',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'ld', value: { name: 'mainLd', rungs: [ladderRung] } },
          documentation: '',
        },
      },
      {
        type: 'program',
        data: {
          name: 'mainFbd',
          language: 'fbd',
          variables: [
            {
              name: 'X1',
              class: 'input',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
            {
              name: 'Y1',
              class: 'output',
              type: { definition: 'base-type', value: 'BOOL' },
              location: '',
              documentation: '',
            },
          ],
          body: { language: 'fbd', value: { name: 'mainFbd', rung: fbdRung } },
          documentation: '',
        },
      },
    ],
    configuration: {
      resource: {
        tasks: [{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }],
        instances: [{ name: 'inst0', task: 'task0', program: 'mainSt' }],
        globalVariables: [
          {
            name: 'gvar',
            class: 'global',
            type: { definition: 'base-type', value: 'BOOL' },
            location: '',
            documentation: '',
          },
        ],
      },
    },
  } as unknown as PLCProjectData
}

describe('parsePlcopenXml — round trip against XmlGenerator (old-editor)', () => {
  const fixture = makeFixture()
  const generated = XmlGenerator(fixture, 'old-editor')
  const result = parsePlcopenXml(generated.data as string)

  it('generates successfully and produces no parse warnings', () => {
    expect(generated.ok).toBe(true)
    expect(result.warnings).toEqual([])
  })

  it('recovers the hardcoded project name the generator always writes', () => {
    expect(result.projectName).toBe('Unnamed')
  })

  it('recovers all three data type derivations', () => {
    const byName = Object.fromEntries(result.projectData.dataTypes.map((d) => [d.name, d]))
    expect(byName.MyStruct).toEqual({
      name: 'MyStruct',
      derivation: 'structure',
      variable: [{ name: 'flag', type: { definition: 'base-type', value: 'BOOL' }, initialValue: undefined }],
    })
    expect(byName.MyEnum).toEqual({
      name: 'MyEnum',
      derivation: 'enumerated',
      initialValue: 'RED',
      values: [{ description: 'RED' }, { description: 'GREEN' }],
    })
    expect(byName.MyArray).toEqual({
      name: 'MyArray',
      derivation: 'array',
      baseType: { definition: 'base-type', value: 'INT' },
      initialValue: '0',
      dimensions: [{ dimension: '0..9' }],
    })
  })

  it('recovers the ST program verbatim', () => {
    const pou = result.projectData.pous.find((p) => p.name === 'mainSt')
    expect(pou?.pouType).toBe('program')
    expect(pou?.documentation).toBe('ST program')
    expect(pou?.interface?.variables).toEqual([
      {
        name: 'a',
        class: 'input',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        initialValue: null,
        documentation: '',
      },
    ])
    expect(pou?.body).toEqual({ language: 'st', value: 'a := TRUE;' })
  })

  it('recovers the IL function-block verbatim', () => {
    const pou = result.projectData.pous.find((p) => p.name === 'mainIl')
    expect(pou?.pouType).toBe('function-block')
    expect(pou?.body).toEqual({ language: 'il', value: 'LD 1' })
  })

  it('recovers the LD program rung: power rails, contact, coil, and their wiring', () => {
    const pou = result.projectData.pous.find((p) => p.name === 'mainLd')
    expect(pou?.body.language).toBe('ld')
    const ldBody = pou?.body.value as {
      name: string
      updated: boolean
      rungs: Array<{ nodes: unknown[]; edges: unknown[] }>
    }
    expect(ldBody.name).toBe('mainLd')
    expect(ldBody.updated).toBe(false)
    expect(ldBody.rungs).toHaveLength(1)
    const rung = ldBody.rungs[0]
    // Node order follows the raw XML's element-type grouping (leftPowerRail,
    // rightPowerRail, contact, coil), not rung/visual position.
    expect(rung.nodes.map((n) => (n as { id: string }).id).sort()).toEqual(
      ['left-rail-1', 'right-rail-4', 'CONTACT-2', 'COIL-3'].sort(),
    )
    expect(rung.edges).toHaveLength(3)
    const nodesById = new Map(
      (rung.nodes as Array<{ id: string; data: { variable: { name: string } } }>).map((n) => [n.id, n]),
    )
    const contactNode = nodesById.get('CONTACT-2') as { data: { variable: { name: string } } }
    const coilNode = nodesById.get('COIL-3') as { data: { variable: { name: string } } }
    expect(contactNode.data.variable).toEqual({ name: 'X1' })
    expect(coilNode.data.variable).toEqual({ name: 'Y1' })
  })

  it('recovers the FBD program rung: input/output variable nodes and their edge', () => {
    const pou = result.projectData.pous.find((p) => p.name === 'mainFbd')
    expect(pou?.body.language).toBe('fbd')
    const fbdBody = pou?.body.value as {
      name: string
      updated: boolean
      rung: { nodes: unknown[]; edges: unknown[] }
    }
    expect(fbdBody.name).toBe('mainFbd')
    expect(fbdBody.updated).toBe(false)
    expect(fbdBody.rung.nodes).toHaveLength(2)
    expect(fbdBody.rung.edges).toHaveLength(1)
    const nodes = fbdBody.rung.nodes as Array<{ id: string; data: { variable: { name: string } } }>
    expect(nodes.find((n) => n.id === 'INPUT-VARIABLE-1')?.data.variable).toEqual({ name: 'X1' })
    expect(nodes.find((n) => n.id === 'OUTPUT-VARIABLE-2')?.data.variable).toEqual({ name: 'Y1' })
  })

  it('recovers the task/instance/global-variable configuration', () => {
    const { resource } = result.projectData.configurations
    expect(resource.tasks).toEqual([{ name: 'task0', triggering: 'Cyclic', interval: 'T#20ms', priority: 0 }])
    expect(resource.instances).toEqual([{ name: 'inst0', task: 'task0', program: 'mainSt' }])
    expect(resource.globalVariables).toEqual([
      {
        name: 'gvar',
        class: 'global',
        type: { definition: 'base-type', value: 'BOOL' },
        location: '',
        initialValue: null,
        documentation: '',
      },
    ])
  })
})

describe('parsePlcopenXml — dialect scope', () => {
  const baseXml = (bodyXml: string) => `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201">
  <contentHeader name="Test Project"/>
  <types>
    <dataTypes/>
    <pous>
      <pou name="unsupported" pouType="program">
        <interface/>
        <documentation><xhtml:p> </xhtml:p></documentation>
        <body>${bodyXml}</body>
      </pou>
    </pous>
  </types>
  <instances>
    <configurations>
      <configuration>
        <resource/>
      </configuration>
    </configurations>
  </instances>
</project>`

  it('produces a warning (does not throw) for an SFC body', () => {
    const result = parsePlcopenXml(baseXml('<SFC/>'))
    expect(result.projectData.pous).toEqual([])
    expect(result.warnings).toEqual([
      'POU "unsupported": Sequential Function Chart is not supported by the importer, skipped',
    ])
  })

  it('produces a warning (does not throw) for a body shape outside the old-editor dialect', () => {
    // Simulates a codesys-dialect (or otherwise foreign) body: none of ST/IL/LD/FBD/SFC.
    const result = parsePlcopenXml(baseXml('<UnknownDialectBody/>'))
    expect(result.projectData.pous).toEqual([])
    expect(result.warnings).toEqual(['POU "unsupported": no recognized body language found, skipped'])
  })

  it('recovers the real project name when the XML carries one', () => {
    const result = parsePlcopenXml(baseXml('<SFC/>'))
    expect(result.projectName).toBe('Test Project')
  })

  it('defaults projectName to "" when <contentHeader> has no name attribute', () => {
    const xml = `<?xml version="1.0"?><project><contentHeader/><types><dataTypes/><pous/></types><instances/></project>`
    const result = parsePlcopenXml(xml)
    expect(result.projectName).toBe('')
  })
})

describe('parsePlcopenXml — malformed connection reference', () => {
  it('produces a warning (does not crash) for a <connection refLocalId> that does not exist', () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<project xmlns="http://www.plcopen.org/xml/tc6_0201">
  <contentHeader name="Malformed"/>
  <types>
    <dataTypes/>
    <pous>
      <pou name="dangling" pouType="program">
        <interface/>
        <documentation><xhtml:p> </xhtml:p></documentation>
        <body>
          <FBD>
            <outVariable localId="9" executionOrderId="0" width="80" height="30" negated="false">
              <position x="0" y="0"/>
              <connectionPointIn>
                <relPosition x="0" y="15"/>
                <connection refLocalId="doesnotexist"/>
              </connectionPointIn>
              <expression>Y1</expression>
            </outVariable>
          </FBD>
        </body>
      </pou>
    </pous>
  </types>
  <instances>
    <configurations>
      <configuration>
        <resource/>
      </configuration>
    </configurations>
  </instances>
</project>`

    expect(() => parsePlcopenXml(xml)).not.toThrow()
    const result = parsePlcopenXml(xml)
    const pou = result.projectData.pous.find((p) => p.name === 'dangling')
    const fbdBody = pou?.body.value as { rung: { edges: unknown[] } }
    expect(fbdBody.rung.edges).toEqual([])
    expect(result.warnings).toEqual([
      'POU "dangling": FBD connection references unknown localId "doesnotexist", skipped',
    ])
  })
})
