# 03 — Política de estado

## Propriedade antes de divisão

A migração possui instâncias de estado próprias, sem leitura, escrita ou sincronização em runtime com a store do produto antigo. Dados de projetos existentes entram por leitura/importação validada pelos adapters novos. Separar a store por responsabilidade e frequência de atualização, não criar uma store por componente. Zustand vanilla continua sendo uma implementação proposta para estado observável. O domínio, os contratos públicos, os casos de uso e os componentes não conhecem Zustand.

| Categoria                                                                    | Proprietário proposto                  | Persistência                                            |
| ---------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| Projeto/documento, POUs, tipos, variáveis, configurações e grafos semânticos | Document state por sessão de projeto   | Por serializer e project port                           |
| Revisões, dirty, undo/redo e mudanças pendentes                              | Mesmo limite transacional do documento | Política explícita; não serializar store inteira        |
| Bibliotecas, catálogos e dados remotos                                       | Serviço/cache responsável pelo recurso | Conforme origem; separar cache de edição local          |
| Operações save/build/import/export                                           | Coordenador da operação                | Normalmente não persistir                               |
| Target e conexão ativa                                                       | Sessão de target                       | Persistir preferência quando aplicável, não sessão viva |
| Amostras de debug, telemetria e logs                                         | Serviços com buffers limitados         | Somente quando houver requisito de exportação           |
| Tabs, painéis, seleção compartilhada e preferências                          | Workspace/presentation state           | Preferências versionadas por settings port              |
| Hover, foco e abertura de popover local                                      | Primitiva/view local                   | Não persistir                                           |

Cache de dados remotos fica atrás de um contrato próprio. Não duplicar a mesma coleção em Query e Zustand sem definir qual é a autoridade. Avaliar a ferramenta existente por recurso durante a fase 0; não tornar uma biblioteca específica parte do contrato comum.

## Regras de consistência

1. Cada dado editável tem uma representação canônica, proprietário e política de commit.
2. Uma edição de documento confirma invariantes e publica uma revisão coerente; histórico e dirty são atualizados na mesma transação.
3. Views e adapters não podem chamar `setState`, ler a store inteira nem escrever suas entidades diretamente.
4. Ports de estado são interfaces específicas definidas na aplicação. Não substituir `RootState` por outra interface igualmente global.
5. Mudanças que atravessam documento, workspace e sessão são coordenadas por caso de uso. O documento permanece atomicamente válido mesmo se uma atualização visual posterior falhar.
6. Estado derivável é projetado e memoizado por suas dependências/revisões; só armazenar índices derivados quando houver custo medido e invalidação definida.

## Documento, Monaco e editores gráficos

Modelo proposto: texto e grafos semânticos pertencem ao documento. Nós do React Flow, decoração de debug, viewport e objetos Monaco são representações de edição/renderização, sem identidade como formato persistido.

Drag e resize podem manter um rascunho visual temporário. Ao confirmar, emitem um comando semântico que atualiza documento, revisão e histórico. A sincronização de texto pode ser incremental para evitar cópias integrais; seu limite e responsabilidade precisam constar do contrato.

Buffers ainda não incorporados, composição IME e alterações de extensões são consolidados por um `DocumentBufferPort` implementado pela integração do editor. O caso de uso de save/build chama essa barreira e captura a revisão consolidada. Não depender de um `useEffect` ou timer ter rodado antes do clique.

A integração de editor pode conhecer Monaco/React Flow; validação IEC, alocação de endereços, renomeação de referências, serialização e classificação de bibliotecas ficam fora dela. Programas externos e ferramentas de IA também editam pelo mesmo caminho transacional.

Eliminar a dupla autoridade dos fluxos LD/FBD é um alvo, não uma mudança automática de formato. Primeiro caracterizar write-back, campos desconhecidos, ordenação, undo/redo e serialização; preservar arquivos existentes durante a reescrita.

## Save, dirty e revisões

- Save captura snapshot imutável da revisão R e serializa uma vez.
- Se o usuário edita durante o I/O, o sucesso confirma R; a revisão posterior permanece dirty.
- Saves sobre o mesmo projeto são coordenados para impedir que a resposta ou escrita antiga substitua a mais nova.
- Dirty não se resume à profundidade do undo. Usar identidade do conteúdo salvo ou checkpoints equivalentes que reconheçam retorno ao estado salvo; a estratégia será escolhida com testes de custo e semântica.
- Falhas não avançam o checkpoint salvo. Arquivos desconhecidos e conteúdo bruto preservado continuam fazendo parte do snapshot.
- Atomicidade de escrita externa depende do backend/filesystem. Quando não suportada, registrar semântica parcial, recuperação e limite do adapter; uma transação em memória não torna HTTP ou filesystem atomicamente transacionais.

## Concorrência e cancelamento

Operações carregam IDs de sessão, geração do target, request e revisão relevante. Antes de aplicar uma resposta, verificar o contexto capturado. Cancelamento usa um port compatível com o transporte; mesmo quando abortar não for possível, a resposta obsoleta não pode atualizar a sessão atual.

Build tem exclusão mútua no coordenador, compartilhada por clique, atalho, menu e IA. Locks não vivem em `useState` do botão. Retry, timeout e revalidação de permissão pertencem à aplicação/infraestrutura conforme a responsabilidade; efeitos não idempotentes não recebem retry automático indiscriminado.

Troca de projeto encerra timers, requisições, subscriptions e buffers da sessão anterior. Timers e caches são instanciados por factory, nunca em escopo de módulo com chave apenas pelo nome da POU.

## Otimização mensurável

- Assinar modelos pequenos por painel ou entidade; não assinar o documento inteiro para renderizar um indicador.
- Normalizar entidades por ID onde isso simplifique edição/referências; preservar ordem explicitamente.
- Reutilizar referências imutáveis de entidades não alteradas.
- Limitar retenção de histórico, logs e amostras; definir orçamento em medições, não em números arbitrários.
- Separar debug de alta frequência do documento editável e da árvore/explorer.
- Coalescer atualizações visuais de telemetria preservando o dado necessário ao debugger.
- Usar workers para tarefas que excedam o orçamento de interação, com payload e revisão identificados; não exigir worker para toda função.
- Medir custo de projeção, serialização e sincronização de editor antes de adicionar caches.

Mais stores não garantem menos renders. A prova é o isolamento de assinaturas e a consistência dos fluxos registrados em [validação](06-validacao.md).
