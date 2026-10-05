/**
 * O placeholder de 1024 nao pode virar projeto.
 *
 * Marcone, testando com o painel de diagnostico: criar um servidor Modbus
 * mostrava 1024 em todos os campos, mas "esses valores nao estao de fato
 * setados". Duas coisas conspiravam, e as duas estao aqui:
 *
 *  1. a tela exibia DEFAULT_BUFFER_MAPPING como se fosse do projeto;
 *  2. e editar UM campo persistia os OITO, porque o reducer mesclava sobre
 *     esses defaults -- devolvendo ao projeto a imagem fixa de 8192 bits e
 *     1024 registradores que esta demanda existe para remover.
 *
 * `compute-io-image` le contagem persistida como PEDIDO e ausencia como
 * "exponha o que a imagem der", entao a diferenca entre gravado e exibido
 * decide o tamanho da imagem.
 */
import { createStore } from 'zustand/vanilla'

import type { PLCServer } from '../../../middleware/shared/ports/types'
import { createConsoleSlice } from '../slices/console'
import { createDeviceSlice } from '../slices/device'
import { createEditorSlice } from '../slices/editor'
import { createLibrarySlice } from '../slices/library'
import { createProjectSlice } from '../slices/project/slice'
import type { ProjectSliceRoot } from '../slices/project/types'

const makeStore = () =>
  createStore<ProjectSliceRoot>()((...a) => ({
    ...createProjectSlice(...a),
    ...createDeviceSlice(...a),
    ...createConsoleSlice(...a),
    ...createEditorSlice(...a),
    ...createLibrarySlice(...a),
  }))

const seedServer = (s: ReturnType<typeof makeStore>) => {
  const cur = s.getState().project
  const server: PLCServer = {
    name: 'mb',
    protocol: 'modbus-tcp',
    modbusSlaveConfig: { enabled: true, transports: ['tcp'], networkInterface: '0.0.0.0', port: 502 },
  } as PLCServer
  s.setState({ project: { ...cur, data: { ...cur.data, servers: [server] } } })
}

const mappingOf = (s: ReturnType<typeof makeStore>) =>
  s.getState().project.data.servers![0].modbusSlaveConfig!.bufferMapping

describe('contagens do Modbus: gravado x exibido', () => {
  it('um servidor novo nao carrega contagem nenhuma', () => {
    const s = makeStore()
    seedServer(s)
    expect(mappingOf(s)).toBeUndefined()
  })

  it('editar UM campo grava so aquele', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { holdingRegisters: { qwCount: 16 } } })

    const m = mappingOf(s)!
    expect(m.holdingRegisters?.qwCount).toBe(16)
    // e NADA alem disso
    expect(m.holdingRegisters?.mwCount).toBeUndefined()
    expect(m.coils).toBeUndefined()
    expect(m.discreteInputs).toBeUndefined()
    expect(m.inputRegisters).toBeUndefined()
  })

  it('um segundo campo nao apaga o primeiro nem materializa o resto', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { holdingRegisters: { qwCount: 16 } } })
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 24 } } })

    const m = mappingOf(s)!
    expect(m.holdingRegisters?.qwCount).toBe(16)
    expect(m.coils?.qxBits).toBe(24)
    expect(m.discreteInputs).toBeUndefined()
    expect(m.inputRegisters).toBeUndefined()
  })

  it('nenhum 1024 aparece por conta propria', () => {
    const s = makeStore()
    seedServer(s)
    s.getState().projectActions.updateServerConfig('mb', { bufferMapping: { coils: { qxBits: 8 } } })
    // O sintoma exato: 1024 registradores e 8192 bits que ninguem pediu.
    expect(JSON.stringify(mappingOf(s))).not.toContain('1024')
    expect(JSON.stringify(mappingOf(s))).not.toContain('8192')
  })
})
