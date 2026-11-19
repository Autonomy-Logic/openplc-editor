# 07 — Acompanhamento e decisões

## Registro inicial

2026-10-07: documentação inicial criada em `src_migration/` nos dois repositórios. Arquitetura e sequência propostas; nenhuma fase de implementação iniciada. Baseline local e limites registrados no diagnóstico.

## Revisão de premissas

2026-10-07: usuário confirmou redesign básico de placement e acesso às features, ausência de bridges e execução independente da migração até o time decidir substituir o produto em produção. Essa orientação substitui a premissa inicial de preservação visual e a proposta de integração por bridges/cutover por fluxo. Nenhuma fase de implementação foi iniciada.

## Decisões

| ID  | Decisão                                                                                                         | Estado               | Condição para revisão                                   |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------- |
| D01 | Construir código novo em `src_migration`, interface primeiro e lógica depois                                    | Requisito do usuário | Alteração explícita de escopo                           |
| D02 | Retirar lógica/estado de aplicação e acesso direto a Zustand da interface; consumir por DI                      | Requisito do usuário | Alteração explícita de escopo                           |
| D03 | Separar estilos para facilitar mudanças futuras                                                                 | Requisito do usuário | Alteração explícita de escopo                           |
| D04 | Manter React e Zustand vanilla atrás de contratos                                                               | Proposta             | Baseline ou protótipo demonstrar limitação              |
| D05 | Factories explícitas, controllers headless e bindings React mínimos                                             | Proposta             | Complexidade de composição justificar outro mecanismo   |
| D06 | Redesign básico de placement, navegação e acesso às features de UI                                              | Requisito do usuário | Alteração explícita de escopo                           |
| D07 | Tokens semânticos, receitas externas e integração específica de widgets                                         | Proposta             | Escolha de CSS Modules ou receitas Tailwind na fase 0   |
| D08 | Dois repositórios com manifesto comum e gates; sem novo pacote inicialmente                                     | Proposta             | Definição de distribuição/versionamento de pacote comum |
| D09 | Documento canônico, revisão e histórico no mesmo limite transacional                                            | Proposta             | Caracterização dos editores e prova de round-trip       |
| D10 | Harness isolado; ferramenta de catálogo ainda aberta                                                            | Pendente             | Decisão na fase 0                                       |
| D11 | Sem bridges, imports ou chamadas de runtime à implementação do legado; portabilidade gradual para a árvore nova | Requisito do usuário | Alteração explícita de escopo                           |
| D12 | Aplicação de migração independente até o time decidir substituir o produto em produção                          | Requisito do usuário | Decisão de prontidão registrada pelo time               |

Para alterar uma decisão, registrar contexto, opções, escolha, consequências e evidência aqui ou em um ADR vinculado. Não reescrever a história para tratar uma proposta como requisito aprovado.

## Perguntas que orientam a fase 0

- Quais mudanças de placement, agrupamento de comandos e acesso às features compõem o redesign básico?
- Os repositórios permanecerão independentes durante toda a migração ou haverá distribuição comum?
- Quais fluxos e plataformas são necessários no primeiro piloto operacional?
- Quais projetos de referência representam uso real e podem virar fixtures sem dados privados?
- Quem define os budgets de desempenho, aprova o redesign e participa da decisão de prontidão para substituir o produto?

Essas perguntas não impedem manter esta documentação inicial. Respostas devem entrar nas decisões e mudar o plano quando afetarem escopo ou sequência.

## Inventário inicial por fluxo

Todas as linhas abaixo precisam de detalhamento na fase 0; nenhuma está implementada.

| Fluxo                         | Origem a investigar                                                  | Owner novo proposto                         | Principal prova                               |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| Open/create/close e workspace | Router, start screen, project/shared slices e project adapters       | Project session coordinator                 | Troca de sessão e reopen nas duas plataformas |
| Edit/save/save as             | Monaco, `save-actions.ts`, `save-project-as.ts`, file/history slices | Document commands + persistence coordinator | Round-trip, revisão e dirty                   |
| LD/FBD/SFC                    | Views gráficas, ladder/fbd/editor slices e write-back                | Graph document commands                     | Drag, referências, undo e flush               |
| Variáveis/tipos/aliases       | Project slice e utilitários IEC                                      | Domain policies + document commands         | Renomeação e compilação equivalente           |
| Libraries/LSP                 | Hydration, library slice, serviços LSP e widgets Monaco              | Library service + language service ports    | Ordem de hydration e descarte                 |
| Devices/IO/VPP                | Device slice, capability/registry helpers e adapters                 | Target session + configuration commands     | Persistência e target obsoleto                |
| Build/upload/runtime          | Activity bar, compiler/runtime ports e adapters                      | Build/runtime coordinators                  | Gates, snapshot e concorrência                |
| Debug/simulator               | Hooks, workspace, debugger/simulator e transports                    | Debug session service                       | Lifecycle e isolamento de telemetria          |
| Source control                | Version-control slice, serviços e ports                              | Version control coordinator                 | Diffs sem alterações espúrias                 |
| Import/export/print           | Serviços de import/export/print e project port                       | Casos de uso específicos                    | Preservação de formato e saída                |
| IA/extensões                  | Tool executor, context collector, panels e ai port                   | Tools via API pública + extension registry  | Mesmo caminho de edição e validação           |
| Menus/atalhos/CLI             | Accelerator/window ports e entry points do editor                    | Adapters de entrada dos casos de uso        | Mesmo comportamento sem view montada          |

## Checklist de fases

- [ ] Fase 0: inventário, baseline e decisões
- [ ] Fase 1: harness, contratos, composição e gates
- [ ] Fase 2: redesign básico, design system e shell com fixtures
- [ ] Fase 3: views e contratos das features
- [ ] Fase 4: fluxo real open/edit/save/reopen
- [ ] Fase 5: edição e configurações completas
- [ ] Fase 6: operações, runtime/debug e demais fluxos
- [ ] Fase 7: prontidão, decisão do time e substituição do produto

## Registro por subfluxo

Duplicar o formulário abaixo para cada unidade de migração:

```text
Fluxo e responsável:
Fase e status:
Comportamento de referência e versão:
Referências do legado e trechos a reimplementar/portar:
Contrato novo e camada proprietária:
Fonte canônica, transação e persistência:
Dependências próprias e evidência de independência do legado:
Diferenças web/editor:
Cenários de fixture:
Testes de caracterização, unidade, contrato e E2E:
Mudanças de placement/acesso, aceite do redesign e evidência manual:
Benchmark antes/depois:
Integração na migração e contribuição para a prontidão do produto:
Compatibilidade de dados e procedimento de rollback da release:
Pendências e próxima ação:
Links locais, commits e PRs quando existirem:
```

Somente marcar uma fase/subfluxo concluído quando houver evidência vinculada. Atualizar os documentos da camada alterada na mesma entrega. Não registrar ganho de performance sem medição nem paridade completa apenas por comparação de arquivos.
