# 06 — Validação, prontidão e rollback

## Definição de pronto

Uma feature está migrada quando possui contratos públicos, view com fixtures, implementação headless, proprietário de estado, adapters por plataforma, testes de comportamento, evidência manual e documentação atualizada. Também precisa executar sem implementação, bootstrap ou store do legado. Chamar o legado por bridge não é uma etapa permitida. Uma feature pronta dentro da migração ainda não significa que o produto esteja pronto para substituir a produção.

## Matriz de verificação

| Nível          | Evidência necessária                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| Arquitetura    | Imports internos/externos, aliases, reexports e ciclos respeitam as camadas; arquivos sem classificação falham |
| Domínio        | Regras IEC, referências, alocação, transformação e validação independem de React/store                         |
| Aplicação      | Sequência de efeitos, falhas, confirmações, exclusão mútua, concorrência e descarte                            |
| Estado         | Transações, revisões, dirty, undo/redo, estabilidade de snapshots e isolamento por instância                   |
| Apresentação   | Projeções e intenções são testáveis sem montar React nem expor Zustand                                         |
| Interface      | Props e eventos, acessibilidade, fixtures de estados e comparação visual                                       |
| Adapters       | Contratos de sucesso/erro/cancelamento, persistência e lifecycle específicos da plataforma                     |
| Integração/E2E | Fluxos completos no browser e Electron com I/O real ou backend de teste controlado                             |
| Manual         | Reabrir projeto salvo, atalhos, menus, temas, editors e workflows próprios de cada plataforma                  |

Web usa Vitest e editor usa Jest. Compartilhar especificações e fixtures de contrato, com wrappers de runner quando necessário. Não exigir testes literalmente idênticos quando as APIs de mocking divergem. Revisar os thresholds e a descoberta na configuração implementada para `src_migration`; não enfraquecer gates do legado.

## Independência e aceite do redesign

- Build e bootstrap novos não importam ou carregam módulos de `src/`, incluindo main/preload, workers, serviços internos e assets executáveis.
- Testes da migração não precisam iniciar a aplicação antiga; fixtures de referência são dados copiados/versionados, não imports de implementação.
- Cada fluxo funciona no processo/app novo com estado próprio e adapters próprios. Recursos externos permitidos e configurações necessários são documentados.
- Sessões de desenvolvimento usam projetos/copias e recursos de teste identificados; não há sincronização automática de drafts ou stores entre aplicações. O setup define como evitar que os dois produtos escrevam simultaneamente sobre o mesmo projeto ou target.
- Features ausentes são declaradas como indisponíveis; operações reais não recebem sucesso de fixture nem fallback para o legado.
- Placement e caminhos de acesso são comparados ao redesign aprovado; resultados funcionais e dados são comparados à caracterização acordada.
- O time valida descoberta de features, teclado/foco, feedback e consistência entre web e editor.

## Regressões obrigatórias por fluxo relevante

- Abrir A, começar trabalho assíncrono, abrir B: a resposta de A não altera B.
- Trocar target durante discovery, hidratação VPP, build ou debug: resultados antigos não são aplicados ao target atual.
- Editar durante save: o sucesso da revisão anterior não limpa mudanças novas.
- Duplo save/build por clique e atalho: exclusão e ordenação pertencem à aplicação.
- Save/build/undo durante edição gráfica pendente: snapshot atualizado, ou falha explícita de consolidação.
- Fechar/reabrir e recarregar: documento e configurações persistem corretamente nas duas plataformas.
- Cancelar confirmação/tarefa e repetir: nenhum listener/timer duplicado ou operação fantasma.
- Renomear/deletar entidade: referências, histórico, tabs e dirty permanecem coerentes.
- Documento não alterado: round-trip preserva conteúdo/formatos e não cria diffs artificiais.
- Dados ausentes, `undefined`, `null` e `false`: preservar semântica dos contratos existentes; não unificar ausência de informação com recusa.
- Instanciar duas aplicações/projetos com POUs de mesmo nome: timers, caches e eventos ficam isolados.
- Tema e mudança de densidade: gráficos, handles, hit testing, portais e foco continuam corretos.

## Benchmark reproduzível

Na fase 0, escolher projetos de referência pequenos e grandes, incluindo ST e LD/FBD, e uma sessão de debug representativa. Registrar fixture/versão, máquina, plataforma, modo de build, passos, repetição e instrumentação. Distinguir desenvolvimento de build de produção.

Medir latência de input, edição/undo, open/save/build preparation, commits/renders por painel, duração de projeções, heap depois de ciclos open/close e tamanho de bundle. Comparar distribuições, não apenas uma execução. Como o layout muda, comparar tarefas equivalentes e registrar condições de visibilidade/assinatura dos painéis; não interpretar uma diferença de renders causada pelo redesign como ganho de arquitetura automaticamente. Definir budgets após a baseline; ainda não há números nem promessa percentual.

Critérios de isolamento: atualização de debug não invalida documento/explorer; mudança de um indicador não renderiza todos os painéis; fechar uma sessão libera recursos; editar uma entidade não reconstrói todas as coleções sem necessidade. Instrumentar as projeções além dos renders.

## Paridade entre repositórios

O gate novo compara o manifesto comum de `src_migration`, mantendo também a verificação antiga. Fixtures e contratos relevantes são comuns; testes específicos de runtime e adapters podem divergir com classificação explícita. Code identity não prova comportamento de persistência ou transporte.

Durante preparação, resolver a classificação do drift registrado em [diagnóstico](01-diagnostico.md). Não usar as 17 diferenças existentes como permissão para novas diferenças. Se persistir alguma exceção transitória, registrar arquivo, razão, responsável e critério de remoção.

Checks existentes usam o script abaixo, a partir de cada repositório:

```sh
python3 scripts/compare-surfaces.py --web-root ../openplc-web/src --editor-root ../openplc-editor/src
```

Esse comando cobre o legado; não valida a pasta nova. Os comandos e gates da migração serão documentados após sua implementação na fase 1.

## Prontidão e substituição em produção

1. Consolidar a matriz de cobertura do produto novo: funcionalidades implementadas, diferenças intencionais, lacunas, suporte por plataforma e evidência de compatibilidade dos projetos.
2. Verificar aceite do redesign, qualidade dos fluxos completos, desempenho, build/packaging, instalação, autenticação e integrações necessárias ao produto independente.
3. O time revisa as evidências, define o conjunto de funcionalidades necessário para substituição e decide explicitamente se o produto está pronto. Lacunas só podem ser aceitas por decisão registrada; até lá a migração continua separada.
4. Preparar a release do novo produto, procedimento de atualização/importação dos dados existentes, backups, recuperação e versão do produto anterior para rollback.
5. Após a decisão do time, substituir o entry point/build do produto em produção. Fazer smoke nas duas plataformas e acompanhar falhas/latência. Não promover componentes ou subfluxos novos dentro da aplicação antiga durante o desenvolvimento.
6. Retirar código antigo somente em mudança própria, depois de revisar consumidores e o período de rollback. A promoção não exige apagar imediatamente o legado.

A migração pode usar os formatos existentes para facilitar compatibilidade. Uma mudança de formato precisa de versionamento, conversão e estratégia de retorno antes da release. A escolha de implantação da release deve preservar a independência das aplicações e não introduzir bridges.

## Rollback do produto

Rollback retorna à versão anterior do produto por procedimento de release/instalação, sem trocar implementações por fluxo na composição. Encerrar operações e decidir salvar, exportar ou descartar drafts antes do retorno; não presumir transferência automática de estado em memória entre produtos.

Dados escritos pelo produto novo precisam continuar legíveis pela versão anterior ou ter conversão/restauração prevista e ensaiada. Backups e política de recuperação são definidos antes da substituição.

Rollback do produto não desfaz upload, comando de runtime ou escrita remota já realizados. Essas operações exigem sua recuperação específica. Ensaiar retorno com projeto salvo, falha parcial e operação cancelada antes da release de substituição.

## Validação realizada nesta entrega

Inspeção estrutural local, contagens textuais e comparação das superfícies do legado. Não foram executados benchmark, aplicação nova, builds, testes funcionais ou E2E: esta entrega contém somente documentação. A revisão documental e a identidade dos documentos entre as bases são verificadas separadamente.
