# 05 — Plano incremental

Cada fase termina com evidência e atualização do acompanhamento. As entregas são integradas somente na aplicação independente de migração; produção permanece no produto atual até a decisão de substituição pelo time. O plano define a sequência técnica; não há cronograma nem estimativa sem inventário e capacidade da equipe. Preparar contratos e fixtures não conta como entrega de funcionalidade integrada.

## Fase 0 — Baseline e decisões

**Entregas:** inventário de telas/fluxos/comandos e estado; projetos de caracterização; screenshots; consumidores fora da UI; benchmark reproduzível; classificação das 17 diferenças locais; registro das decisões ainda propostas.

Definir o limite de cada feature, fonte canônica, escopo do redesign básico e critérios de aceite do layout novo, estratégia de estilos, ferramenta de catálogo e política de módulos compartilhados. Mapear campos persistidos e versões, incluindo arquivos que não são completamente interpretados. Atribuir responsáveis e vincular o trabalho ao processo do projeto antes da implementação.

**Saída:** mapa de placement e acesso às features atual/proposto revisado, referência de comportamento por fluxo e plataforma identificada; riscos e decisões impeditivas resolvidos para iniciar o harness. Nenhuma diferença é corrigida por cópia cega.

**Validação:** testes de caracterização de round-trip, save/undo e fluxos críticos; registro manual dos caminhos web/Electron. Medições não executadas permanecem marcadas como pendentes.

## Fase 1 — Ambiente isolado e fronteiras

**Entregas:** aplicação independente em `src_migration`, com entry points próprios de desenvolvimento/build, bootstrap, factories, contratos iniciais, fixtures e verificador de dependências. Preparar main/preload próprios para o Electron e workers/assets necessários. A aplicação de produção segue no entry point atual.

Ampliar ou criar configurações de TypeScript, lint, tests/cobertura, assets/workers, Tailwind quando utilizado, Vite/webpack e comparação entre bases. Criar alias dedicado `@migration/*`, deixando `@root/*` para o legado e proibindo seu uso pela aplicação nova. Nenhum build novo pode carregar implementação de `src/`, direta ou indiretamente. Os nomes de comandos novos serão definidos na implementação; não existem ainda.

Adicionar manifesto explícito da superfície comum nova: `contracts`, `domain`, `application`, `state`, `presentation`, `react-bindings`, `frontend`, `design-system`, `fixtures` e regras de arquitetura. Classificar subárvores compartilhadas de infraestrutura e testes. Composição e adapters por plataforma são excluídos explicitamente, nunca por exclusão ampla de tudo que pareça diferente.

**Saída:** harness inicia no browser e no renderer Electron; um teste da camada nova é descoberto em cada runner; uma violação proposital falha; arquivo novo não rastreado também é verificado localmente; diferenças no código comum novo falham na comparação e disparam o gate em CI.

**Validação:** smoke de inicialização com entry points próprios, sem bootstrap/store/assets executáveis do legado; configurações e gate negativo para import de `src/`; duas instâncias independentes sem vazamento de eventos.

## Fase 2 — Redesign básico, sistema visual e shell

**Entregas:** layout e navegação revisados, placement dos componentes e acesso às features definidos, tokens, temas, primitivas, receitas e views de start/workspace, árvore, tabs, toolbar, painéis e console com fixtures. Catálogo dos estados de erro, vazio e loading.

**Saída:** shell navegável no harness, sem store/serviços antigos; estilos podem mudar sem editar lógica. Rotas e chrome nativo são compostos por plataforma.

**Validação:** aceite do redesign com o time, comparação com a referência visual nova, descoberta das features, teclado/foco, isolamento de CSS e cenários de capabilities simuladas nas duas plataformas.

## Fase 3 — Contratos e views das features

**Entregas:** formulários e tabelas, editores textuais/gráficos, devices/servers, runtime/debug, bibliotecas, source control, import/export, impressão e IA/extensões com contratos e dados sintéticos. Inventário visual completo dos fluxos acordados.

**Saída:** cada fluxo tem uma view e contrato de apresentação revisável; comandos de demonstração não acionam recursos reais. Dependências visuais complexas são encapsuladas.

**Validação:** testes de contrato e interação, cenas representativas, erro/read-only e testes visuais dos widgets. Ao final, o frontend está desacoplado; a aplicação ainda não está funcionalmente migrada.

## Fase 4 — Projetos, documentos e workspace reais

**Entregas:** domínio inicial, estado transacional, controllers reais, open/create/close, tabs/seleção, edição textual, revisões/dirty, undo/redo, snapshot, serializer e save. Implementar e conectar adapters próprios de persistência web e editor, portando a lógica necessária para a árvore nova sem chamar a aplicação antiga.

Primeiro fluxo vertical: abrir projeto -> selecionar POU ST -> editar -> salvar -> fechar/reabrir. Bibliotecas necessárias ao carregamento e classificação fazem parte desse fluxo, não ficam para depois. Formatos antigos e arquivos não interpretados são preservados.

**Saída:** fluxo vertical passa em browser e Electron com contratos idênticos e I/O próprio de cada plataforma. Aplicação controla coordenação; views não mudam para receber implementação real.

**Validação:** unitários de invariantes/revisões, contrato de adapters, E2E nas duas bases, save durante edição, falha de persistência e round-trip sem alterações espúrias.

## Fase 5 — Edição completa e configurações

**Entregas:** LD/FBD/SFC, tabelas de variáveis, tipos, referências/aliases IEC, buffers de editor/LSP, libraries, device/server/remote IO, plugins e VPP. Um caminho transacional atende mouse, teclado, importações e ferramentas.

Migrar por subfluxo completo, mantendo formato persistido e undo/redo coerentes. Reduzir representações duplicadas dos grafos e implementar a barreira de buffers antes de snapshot.

**Saída:** cada editor/conjunto de configurações tem proprietário de estado, modelo canônico e serializer; o subfluxo executa integralmente na migração, com dependências e recursos próprios.

**Validação:** caracterização de semântica PLC, texto/tabela sincronizados, referências renomeadas, drag/undo/save, campos desconhecidos preservados e troca rápida de projeto/target.

## Fase 6 — Build, runtime, debug e operações restantes

**Entregas:** coordenadores compartilhados de build/upload, gates, confirmações, status de runtime, debugger/simulador, import/export, source control, print e IA. Menus, atalhos e CLI passam pelos mesmos casos de uso quando aplicável.

Eliminar montagem duplicada de snapshots de save/build/upload. Separar transporte e sessões de debug da projeção visual. Ferramentas de IA não ganham caminho alternativo de mutação.

**Saída:** fluxos operacionais não dependem de uma view montada; operações são exclusivas/canceláveis conforme contrato e ignoram contexto obsoleto. Diferenças de capacidade não produzem sucesso simulado.

**Validação:** gates e ordem de efeitos, duplo acionamento, cancelamento, target obsoleto, progresso/erro, confirmação antiga, upload e evidência física quando o aceite exigir hardware. E2E de impressão e round-trip de import/export.

## Fase 7 — Prontidão, decisão do time e substituição do produto

**Entregas:** inventário de funcionalidades com cobertura e lacunas explícitas, aceite do redesign, comparação de performance, build/packaging independentes, documentação operacional e plano de release/rollback do produto completo. O time avalia as evidências e registra a decisão de substituir o produto em produção; completar fases técnicas não autoriza essa promoção automaticamente.

**Saída:** critérios de [validação](06-validacao.md) satisfeitos em ambas as plataformas e decisão de prontidão registrada pelo time. Após essa decisão, substituir o produto por release do novo entry point/build. A migração pode continuar independente enquanto houver lacunas não aceitas. A retirada de `src/` e eventual renomeação de `src_migration` para `src` são mudanças posteriores próprias, com revisão de aliases, bundlers, CI, assets, packaging e prazo de rollback.

**Validação:** suite final relevante, build/packaging, reload/reopen, manual nas duas plataformas, benchmark e ensaio de rollback.

## Regra para cada subfluxo

```text
Caracterizar legado -> revisar placement/acesso -> definir contrato
  -> criar view/fixture -> validar redesign
  -> reimplementar/portar lógica para as camadas novas
  -> conectar adapters próprios nas duas bases
  -> validar comportamento, independência e desempenho
  -> integrar à aplicação de migração -> atualizar documentação

Produto novo pronto -> avaliação e decisão do time -> release de substituição
```

Durante fases 4–6, subfluxos já prontos são integrados individualmente apenas na aplicação de migração. Não há alternância por feature entre código antigo e novo na aplicação de produção. Não iniciar lógica de um subfluxo antes de sua view/contrato existir. Também não esperar toda a lógica ser reescrita para provar o primeiro open/edit/save real.
