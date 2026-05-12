import type { PLCDataType } from '../../../../middleware/shared/ports/types'
import type { EditorModel } from '../editor'
import type { PouDTO } from '../project'

type PouProps = {
  type: 'program' | 'function' | 'function-block'
  name: string
  language: 'il' | 'st' | 'ld' | 'sfc' | 'fbd' | 'python' | 'cpp'
}

export function createPouObject({ type, name, language }: PouProps): PouDTO {
  const bodyValue =
    language === 'ld'
      ? { language, value: { name, rungs: [] } }
      : language === 'fbd'
        ? { language, value: { name, rung: { comment: '', edges: [], nodes: [] } } }
        : { language, value: '' }

  switch (type) {
    case 'function':
      return {
        type: 'function',
        data: {
          name,
          language,
          body: bodyValue,
          returnType: 'BOOL',
          variables: [],
          documentation: '',
        },
      }
    case 'function-block':
      return {
        type: 'function-block',
        data: {
          name,
          language,
          body: bodyValue,
          variables: [],
          documentation: '',
        },
      }
    case 'program':
      return {
        type: 'program',
        data: {
          name,
          language,
          body: bodyValue,
          variables: [],
          documentation: '',
        },
      }
  }
}

type DatatypeProps = {
  name: string
  derivation: 'array' | 'structure' | 'enumerated'
}

export function createDatatypeObject(data: DatatypeProps): PLCDataType {
  switch (data.derivation) {
    case 'array':
      return {
        name: data.name,
        derivation: 'array',
        baseType: { definition: 'base-type', value: 'BOOL' },
        // Empty stays empty.  The codegen treats `''` as "no
        // initial value" (falsy → no `:= ...` clause emitted),
        // which is what we want for a freshly-created array — the
        // previous `'false'` seed survived a base-type change to
        // e.g. REAL and made the compiler emit
        // `ARRAY [...] OF REAL := false;` (invalid syntax).
        initialValue: '',
        dimensions: [],
      }
    case 'enumerated':
      return {
        values: [],
        initialValue: '',
        name: data.name,
        derivation: data.derivation,
      }
    case 'structure':
      return {
        name: data.name,
        derivation: data.derivation,
        variable: [],
      }
  }
}

export function createEditorObjectForPou(
  name: string,
  pouType: 'program' | 'function' | 'function-block',
  language: string,
): EditorModel {
  const pouLanguage = language.toLowerCase()
  const isGraphical = pouLanguage === 'ld' || pouLanguage === 'sfc' || pouLanguage === 'fbd'

  if (isGraphical) {
    const graphical =
      pouLanguage === 'ld'
        ? { language: 'ld' as const, openedRungs: [] as Array<{ rungId: string; open: boolean }> }
        : pouLanguage === 'fbd'
          ? {
              language: 'fbd' as const,
              hoveringElement: { elementId: null, hovering: false },
              canEditorZoom: true,
              canEditorPan: true,
            }
          : { language: 'sfc' as const }

    return {
      type: 'plc-graphical',
      meta: {
        name,
        path: name,
        pouType,
        language: pouLanguage,
      },
      variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '' },
      graphical,
    }
  }

  return {
    type: 'plc-textual',
    meta: {
      name,
      path: name,
      pouType,
      language: pouLanguage as 'il' | 'st' | 'python' | 'cpp',
    },
    variable: { display: 'table', description: '', classFilter: 'All', selectedRow: '' },
  }
}

export function createEditorObjectForDatatype(name: string, derivation: string): EditorModel {
  return {
    type: 'plc-datatype',
    meta: { name, derivation: derivation as 'enumerated' | 'structure' | 'array' },
    structure: { description: '', selectedRow: '' },
  }
}

export function createEditorObjectForServer(
  name: string,
  protocol: 'modbus-tcp' | 's7comm' | 'ethernet-ip' | 'opcua',
): EditorModel {
  return {
    type: 'plc-server',
    meta: { name, protocol },
  }
}

export function createEditorObjectForRemoteDevice(
  name: string,
  protocol: 'modbus-tcp' | 'ethernet-ip' | 'ethercat' | 'profinet',
): EditorModel {
  return {
    type: 'plc-remote-device',
    meta: { name, protocol },
  }
}

export function createEditorObjectForEtherCATDevice(name: string, busName: string, deviceId: string): EditorModel {
  return {
    type: 'plc-ethercat-device',
    meta: { name, busName, deviceId },
  }
}

export function createTabObject(
  name: string,
  pouType: 'program' | 'function' | 'function-block',
  language: string,
): { type: 'program' | 'function' | 'function-block'; name: string; language: string } {
  return { type: pouType, name, language }
}
