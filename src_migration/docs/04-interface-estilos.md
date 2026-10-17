# 04 — Interface sem lógica de aplicação e estilos independentes

## O que pode existir na interface

Views recebem props de exibição e callbacks de intenção. Podem renderizar listas, escolher uma variante visual e tratar semântica DOM/acessibilidade. Não validam regras IEC, montam payload de projeto, coordenam I/O, calculam capacidade de target ou gerenciam operações de aplicação.

Estado estritamente visual, como foco/hover/popover, pode ficar em primitivas locais. Se um valor participa de save, build, undo, navegação compartilhada ou troca de projeto, pertence ao controller/aplicação, não à view. Campos de formulário com semântica de aplicação são controlados pelo modelo correspondente; o componente emite alteração e exibe a validação recebida.

Se a exigência final for zero estado local inclusive visual, transferir esse estado para controles headless fora das views. A proposta inicial permite estado visual local para não transformar cada interação DOM em comando de aplicação.

## Views e bindings

```text
Controller sem React
  -> snapshot tipado + intenções
React binding
  -> props + callbacks
View
  -> estrutura e interação visual
Design system
  -> receitas, tokens, variantes e acessibilidade
```

Hooks nos bindings somente conectam Context, lifecycle e assinaturas. Mover o corpo de um componente para `useBuild()` mantendo nele a regra de negócio não satisfaz a fronteira. Views não importam bindings; bindings importam e conectam views.

## Redesign básico incluído

Revisar posicionamento dos componentes, agrupamento de comandos, navegação e acesso às features. Na fase 0, produzir um mapa atual/proposto com o que muda, a tarefa atendida e os caminhos de acesso. O novo shell e os fluxos de navegação são desenhados antes de acoplar lógica real.

O redesign mantém os resultados funcionais e formatos de projeto acordados, mas pode mudar a sequência de interação visual. Validar descoberta de features, quantidade de passos, hierarquia dos comandos, teclado/foco e feedback de operações com o time. Não definir aqui posições finais sem essa revisão.

A referência visual passa a ser o layout novo aprovado no catálogo. Screenshots do legado servem para explicar mudanças; não são golden tests de identidade visual. Mudanças de capacidade ou regra funcional precisam ser registradas separadamente das mudanças de placement.

## Catálogo visual primeiro

Criar um harness isolado para componentes e telas. A escolha entre Storybook e um catálogo próprio ainda não está definida; não presumir uma dependência nova. Fixtures implementam os contratos de apresentação e simulam transições explícitas, sem importar a store ou os adapters antigos.

Para cada feature, preparar estados normal, vazio, carregando, indisponível, read-only, erro, confirmação e sucesso, conforme aplicável. As ações simuladas precisam deixar claro que são cenários de demonstração, especialmente build, upload e save.

Cobrir shell/start screen/workspace, menus, árvore, tabs, tabelas de variáveis, console, barra de atividade, formulários de projeto/device e frames dos editores antes de conectar lógica real. Monaco, LD/FBD/SFC e extensões podem usar modelos sintéticos e widgets reais quando necessário para validar interação. Não é necessário reimplementar Monaco ou React Flow.

## Sistema de estilos

Proposta inicial: CSS custom properties semânticas e estilos por componente fora do TSX. Manter Tailwind disponível para o legado; escolher na fase 0 se receitas novas usarão CSS Modules ou receitas Tailwind centralizadas. O critério é alterar aparência sem editar lógica e sem espalhar classes pelos componentes.

```text
design-system/
  tokens/       Cores, tipografia, espaço, dimensões e movimento
  themes/       Valores por tema light/dark e futuro tema de produto
  components/   Primitivas com variantes tipadas e estilos próprios
  recipes/      Aparência de padrões compostos e estados
  integrations/ Temas e estilos de Monaco, React Flow e demais widgets
```

Exemplos de tokens: `--surface-workspace`, `--surface-panel`, `--text-primary`, `--border-subtle`, `--action-primary`, `--status-error`, `--focus-ring`, `--space-control`, `--control-height`. O componente escolhe papel semântico, não valor literal de cor.

Exemplo ilustrativo de regra em arquivo de estilo:

```css
.button {
  color: var(--text-on-action);
  background: var(--action-primary);
  min-height: var(--control-height);
}
```

Tema altera valores; receita altera aparência e layout do componente; view altera estrutura quando necessário. Trocar estrutura DOM ou interação não é uma simples troca de tema. Evitar prometer que tokens sozinhos resolvem todos os redesigns.

Não injetar um objeto gigante de classes por DI em cada componente. DI injeta controllers e, quando preciso, um serviço de preferência de tema. CSS e receitas determinam aparência. Variantes públicas como `size`, `tone` e `density` são tipadas; overrides arbitrários de cada consumidor não substituem o design system.

## Temas de widgets e isolamento

Monaco tem sua própria API de tema; gerar/registrar seus valores a partir dos tokens. React Flow, terminal, gráficos e preview/print também exigem integração específica. Geometria que muda hit testing, handles e posicionamento precisa passar por testes de interação.

A migração executa em aplicação/documento/janela próprios, sem carregar folhas de estilo ou resets da aplicação antiga. Assets e estilos que forem portados passam a pertencer ao design system novo. Testar portais de diálogos, tooltips, estilos globais de widgets e light/dark no escopo da migração.

## Aceite visual

- Placement, navegação e acesso às features correspondem ao redesign aprovado.
- A mesma view roda com fixture e controller real sem alteração de código.
- Light/dark e um tema alternativo de prova são aplicados por tokens/receitas.
- Mudança de aparência de um botão não exige editar o handler ou caso de uso.
- Teclado, foco, labels, diálogos e seleção continuam funcionais.
- Layouts estreitos e estados com textos longos não quebram os controles.
- Nenhum componente da nova interface importa Zustand, store antiga, transporte ou regra de domínio.
