# Re-arquiteturação compartilhada do OpenPLC

Este diretório inicia a documentação da reescrita de openplc-web e openplc-editor. O código novo será construído em `src_migration/` de cada repositório: primeiro a interface com redesign básico, contratos e cenários simulados, depois a incorporação gradual das funcionalidades. A migração roda como aplicação independente; a aplicação atual continua em `src/` e em produção até o time concluir que o produto novo pode substituí-la.

**Status:** proposta técnica inicial, baseada na inspeção local de 2026-10-07. Somente documentação foi criada. Nenhum entry point, store, adapter ou configuração foi alterado. As decisões propostas ainda precisam ser revisadas durante a fase 0.

## Objetivos

- Retirar regras de negócio, processamento de projetos, coordenação de tarefas e Zustand dos componentes e hooks de interface.
- Injetar contratos pequenos de leitura e comandos, sem expor a store ou os ports de infraestrutura à interface.
- Realizar um redesign básico de posicionamento dos componentes, navegação e acesso às features de UI.
- Separar estrutura, comportamento visual e estilos, permitindo trocar tema e aparência com mudanças concentradas.
- Centralizar operações hoje distribuídas entre componentes, serviços, slices e adapters.
- Preservar semântica de projetos, fluxos de edição, persistência e diferenças reais entre browser e Electron.
- Melhorar o gerenciamento de estado com propriedade explícita, transações e assinaturas específicas, validando o desempenho por medição.

## Leitura e uso

| Documento                                                | Uso                                                              |
| -------------------------------------------------------- | ---------------------------------------------------------------- |
| [01 — Diagnóstico](docs/01-diagnostico.md)               | Evidências, limitações do levantamento e baseline das duas bases |
| [02 — Arquitetura](docs/02-arquitetura.md)               | Camadas, DI, contratos e direção das dependências                |
| [03 — Estado](docs/03-estado.md)                         | Proprietários, consistência, concorrência e desempenho           |
| [04 — Interface e estilos](docs/04-interface-estilos.md) | Componentes sem lógica de aplicação e sistema de temas           |
| [05 — Plano](docs/05-plano.md)                           | Fases, entregas, dependências e critérios de saída               |
| [06 — Validação](docs/06-validacao.md)                   | Testes, paridade, medições, prontidão e rollback                 |
| [07 — Acompanhamento](docs/07-acompanhamento.md)         | Decisões, inventário por fluxo e registro de execução            |

Começar pela fase 0 do plano. Depois criar o ambiente isolado e o catálogo visual; conectar a lógica por fluxos completos somente após a aprovação dos contratos visuais correspondentes.

## Premissas e limites

O redesign básico faz parte do escopo: reposicionar componentes e revisar o acesso às features de UI. A referência de aceite visual será o novo desenho aprovado; o legado serve como referência funcional e de formato de dados, sem exigir reprodução do layout antigo. O objetivo não exige manter a organização Atomic Design, substituir React, eliminar Zustand nem mover processamento para um servidor. Lógica desacoplada pode continuar no browser, renderer, worker ou processo principal conforme o adapter.

Reescrever do zero significa construir módulos novos com as fronteiras propostas. Funcionalidades e algoritmos do legado serão trazidos aos poucos por reimplementação ou portabilidade de código para a árvore nova, revisados e testados sob os novos contratos. A migração não importa, chama ou delega operações à implementação de `src/`: não há bridges, fallback para o legado nem seleção por fluxo dentro do produto atual.

O produto novo tem bootstrap, composição, estado, recursos e execução próprios. Pode consumir os serviços externos e formatos existentes por adapters próprios; isso não implica dependência da aplicação antiga. O time decide a substituição do produto em produção após os critérios de prontidão. Funcionalidade concluída na migração não é automaticamente promovida à produção.

Os dois repositórios continuarão separados nesta proposta. Módulos comuns serão espelhados com verificação de identidade; extrair um pacote físico único é uma decisão adicional, pois exige definir distribuição, versionamento e releases. A localização desse eventual pacote ainda não está definida.

## Estrutura prevista

```text
src_migration/
  contracts/           Contratos públicos de aplicação e apresentação
  domain/              Modelos e regras independentes de frameworks
  application/         Casos de uso, coordenação e ports de saída
  state/               Implementações de estado, sem React
  presentation/        Controllers e projeções, sem React ou Zustand
  react-bindings/      Context, assinaturas React e conexão com views
  frontend/            Views e layouts orientados a props
  design-system/       Primitivas visuais, receitas e temas
  infrastructure/      Adapters próprios por plataforma
  composition/         Montagem e lifecycle por plataforma
  fixtures/            Cenários simulados que implementam os contratos
  __architecture__/    Verificação de fronteiras
  docs/                Documentação desta migração
```

Essa estrutura ainda não foi implementada. A existência desta pasta não habilita uma aplicação nova nem amplia os checks atuais.
