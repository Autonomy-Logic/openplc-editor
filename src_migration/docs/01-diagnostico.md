# 01 — Diagnóstico e baseline

## Evidência local

Inspeção de 2026-10-07 dos checkouts `openplc-web` e `openplc-editor` no workspace. HEADs: web `61028259a`, editor `f56d179fb`. Eles não foram alinhados a uma mesma release para esta análise. Nenhuma conclusão abaixo representa um benchmark de execução.

| Evidência                                                                                             | Consequência para a migração                                                                              |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Ambos usam `createOpenPLCStore()` com 19 slices, `zustand/vanilla` e `subscribeWithSelector`          | Já existe uma factory reutilizável como referência; não começar de uma suposição de singleton obrigatório |
| `OpenPLCStoreProvider` injeta a store por Context                                                     | DI já existe, mas seu contrato expõe a implementação e o `RootState`                                      |
| 167 arquivos de componentes por base referenciam `useOpenPLCStore`, `OpenPLCStore` ou `RootState`     | A interface conhece estado de aplicação e/ou seus tipos                                                   |
| 94 arquivos de componentes por base chamam `useOpenPLCStore()` sem seletor                            | Existe assinatura ampla; medir atualizações irrelevantes e substituir por projeções específicas           |
| 20 arquivos de hooks e 28 de serviços por base referenciam os mesmos identificadores                  | Mover apenas componentes deixa outras dependências da interface intactas                                  |
| `project/slice.ts`: 2.634 linhas; barra de atividade: 1.411; `save-actions.ts`: 1.142, nas duas bases | Regras e coordenação concentram-se em módulos grandes; dividir por responsabilidade e fluxo               |
| Adapters web recebem `OpenPLCStore` para projeto, build, runtime e hidratação de bibliotecas          | A inversão existente ainda permite infraestrutura conhecer o estado global                                |
| `save-actions.ts` e `project-adapter.ts` possuem caminhos de construção de arquivos de projeto        | Candidatos a uma política única de snapshot e serialização; provar equivalência antes de consolidar       |
| Fluxos LD/FBD possuem write-back para `project.data.pous[].body.value` com debounce                   | Existe uma janela de representações divergentes que save, undo e troca de projeto precisam coordenar      |
| `flow-writeback.ts` possui mapa de timers em escopo de módulo                                         | A nova implementação precisa isolar timers e disposers por instância e sessão                             |
| Classes Tailwind de aparência e geometria aparecem no JSX; cores também vivem na configuração global  | Temas exigem tokens semânticos e receitas separadas do componente                                         |

Contagens consideram `.ts` e `.tsx`, excluindo `__tests__`, `*.test.*` e `*.spec.*`. São buscas textuais, não análise AST: incluem referências de tipos e podem alcançar comentários. Não significam que todos esses arquivos executem regras de negócio.

## Fontes no código atual

Os caminhos abaixo existem nas duas bases, exceto os marcados como web:

- `src/composition-root.ts`: criação da store e dos ports.
- `src/frontend/store/index.ts` e `context.tsx`: composição dos slices e API React.
- `src/frontend/store/slices/project/slice.ts`: regras de projeto e coordenação de entidades.
- `src/frontend/store/slices/history/types.ts`: snapshots de histórico por POU.
- `src/frontend/store/slices/shared/flow-writeback.ts`: sincronização e flush de fluxos gráficos.
- `src/frontend/services/save-actions.ts`: montagem, serialização e fluxo de persistência.
- `src/frontend/components/_organisms/workspace-activity-bar/default.tsx`: build, upload e depuração.
- `src/frontend/components/_atoms/buttons/default/index.tsx`: exemplo de estilos no componente.
- `src/middleware/shared/providers/types.ts`: contratos atuais de plataforma.
- `src/middleware/shared/ports/project-port.ts`: I/O de projeto e responsabilidades adicionais como PDF.
- `src/middleware/adapters/web/project-adapter.ts` e `web-platform.ts` (web): dependências da store.
- `src/__architecture__/validate.ts`: regras atuais de dependência.
- `scripts/compare-surfaces.py` e `.github/workflows/ci-sync.yml`: sincronização atual.

## Paridade observada

O comando executado a partir do workspace foi:

```sh
python3 openplc-web/scripts/compare-surfaces.py --web-root openplc-web/src --editor-root openplc-editor/src
```

Resultado: `match: false`, 1.226 arquivos verificados, 17 diferenças, exit code 1. É um diagnóstico do legado, não uma falha causada por esta documentação. O script exclui testes e considera arquivos rastreados pelo Git.

| Superfície                 | Diferenças |
| -------------------------- | ---------- |
| `frontend`                 | 9          |
| `middleware/shared`        | 2          |
| `backend/shared`           | 5          |
| `__architecture__`         | 1          |
| Runtime bare-metal mapeado | 0          |

Diferenças registradas, relativas a `src/`:

```text
frontend/components/_features/[workspace]/ai-chat/ai-chat-tool-summary.tsx
frontend/components/_features/[workspace]/editor/device/configuration/components/pin-mapping-table.tsx
frontend/components/_molecules/pin-mapping-table/pull-input.tsx [somente web]
frontend/services/ai/tools/index.ts
frontend/services/ai/tools/tool-definitions.ts
frontend/services/ai/tools/tool-executor.ts
frontend/services/ai/tools/tool-input-adapters.ts
frontend/store/slices/device/slice.ts
frontend/store/slices/ladder/utils/rung-spec.ts [somente web]
middleware/shared/ports/types.ts
middleware/shared/utils/pin-pull/index.ts [somente web]
backend/shared/compile/pipeline.ts
backend/shared/compile/steps/generate-defines.ts
backend/shared/compile/steps/resolve-board-selection.ts
backend/shared/hardware/board-info-resolver.ts
backend/shared/types/PLC/devices/pin.ts
__architecture__/validate.ts
```

Classificar cada diferença como alteração pendente de espelhamento, diferença intencional ou defeito antes de escolher o comportamento de referência. Este levantamento não resolve essa classificação.

## Proteções que precisam ser ampliadas

Os TSConfigs incluem `src`; Tailwind pesquisa `src`; descoberta de testes e cobertura usam padrões de `src`; o validador resolve sua raiz dentro de `src`; os gatilhos de sincronização usam as superfícies antigas. Não presumir que qualquer desses checks proteja `src_migration`.

O validador atual permite que componentes importem store, hooks, services e utils, e que adapters importem store. Essas regras são compatíveis com a migração anterior, mas insuficientes para o objetivo novo.

## Levantamento ainda necessário

Antes de implementar, completar inventário de telas, comandos, side effects, entry points, timers, serialização, assinatura de eventos e persistência. Registrar também o placement atual, dificuldades de navegação e proposta de novo acesso às features. O inventário descreve o comportamento a portar e as mudanças de UX, sem autorizar chamadas ao legado. Capturar projetos de referência e medições de renderização, latência, memória e tamanho de bundle. Examinar também rotas web, menus nativos, CLI do editor, workers, LSPs, extensões e ações de IA como consumidores dos mesmos casos de uso.

Este diagnóstico é uma amostra estrutural, não uma auditoria completa nem uma identificação automática de código duplicado.

## Premissas confirmadas após o diagnóstico

O usuário definiu redesign básico e execução independente até a decisão de substituição pelo time. As estruturas atuais são evidência para caracterização e portabilidade gradual; não serão usadas como implementação de runtime por pontes. Comparação visual com o legado registra diferenças, mas não exige identidade do layout.
