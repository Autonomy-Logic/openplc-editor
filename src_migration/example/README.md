# Exemplo de referência: lista de variáveis PLC

Implementação mínima da arquitetura descrita em [`../docs/02-arquitetura.md`](../docs/02-arquitetura.md),
usando todas as camadas. A feature é uma lista de variáveis: adicionar, renomear, remover e salvar, com
validação de identificador IEC 61131-3 e nomes únicos.

O guia completo, com diagrama de dependências, fluxo de dados, revisões, testes por camada e o passo a passo
para criar uma feature nova, está em [`guide.html`](guide.html). Com `pnpm run example:dev` ele abre em
http://localhost:5190/guide.html.

O exemplo é independente da aplicação atual: não importa nada de `src/`, não usa o alias `@root/*` e não
entra em nenhum entry point, build ou release de produção. A pasta é idêntica byte a byte em openplc-web e
openplc-editor.

## Camadas

| Pasta | Responsabilidade | Pode importar (entrada pública) | Pacotes externos |
| --- | --- | --- | --- |
| `contracts/application` | API pública da aplicação: comandos, resultados, snapshot | nada | nenhum |
| `contracts/presentation` | `ReadModel<T>`, modelo de exibição e intenções da view | nada | nenhum |
| `domain` | `Variable`, regras de nome e invariantes do documento | nada | nenhum |
| `application` | Casos de uso (`createVariableListService`) e ports de saída (`application/ports`) | `domain`, `contracts/application` | nenhum |
| `state` | Implementação do port de estado com Zustand vanilla | `domain`, `application/ports` | `zustand/vanilla` |
| `presentation` | Controller headless que projeta o snapshot em `VariableListModel` | `contracts/application`, `contracts/presentation` | nenhum |
| `react-bindings` | Context, `useReadModel` (`useSyncExternalStore`) e conexão controller → view | `contracts/presentation`, `frontend` | `react` |
| `frontend` | Views controladas só por props e callbacks | `contracts/presentation`, `design-system` | `react` |
| `design-system` | Tokens (CSS custom properties), primitivas e receitas em CSS Modules | nada | `react` |
| `infrastructure` | Adapters de persistência: localStorage e memória | `domain`, `application/ports` | nenhum |
| `composition` | Monta store, serviço, controller e adapters; `dispose()`; entry do browser | todas | `react`, `react-dom/client` |
| `fixtures` | Controller simulado que implementa o contrato de apresentação | `contracts/presentation` | nenhum |
| `__architecture__` | Verificação das regras acima | nada | `typescript`, `node:*` |

Regras verificadas por `__architecture__` (teste `boundaries.test.ts`):

- entre camadas, só se importa a entrada pública (`../domain`, nunca `../domain/variable`);
- imports, reexports, `import()` dinâmico e `require` contam igualmente;
- arquivo fora de qualquer camada falha;
- folhas de estilo só em `design-system`;
- qualquer caminho que saia de `src_migration/example` falha, assim como `@root`;
- testes seguem as regras da própria camada e podem usar também `fixtures` e `@testing-library/react`.

As regras estão em `__architecture__/rules.ts`. Mudar uma dependência permitida é uma decisão de
arquitetura, não um ajuste para o teste passar.

## Fluxo de uma intenção

```text
View (frontend)          clique em "Add variable"
  -> intents.submitNew    callback recebido por props
Controller (presentation) lê o rascunho local, chama api.addVariable(...)
Serviço (application)     aplica a regra do domínio e confirma uma revisão no port de estado
Store (state)             novo estado imutável, notifica assinantes
Controller                recalcula o modelo só se o snapshot mudou; reaproveita linhas iguais
Binding (react-bindings)  useSyncExternalStore re-renderiza a view
```

Save captura o documento e a revisão `R` antes do I/O. Sucesso marca `R` como salva; uma edição feita
durante o save mantém o documento sujo. Falha não avança o checkpoint. Um segundo save concorrente é
recusado com `busy`, e respostas que chegam depois de `dispose()` são ignoradas.

## Como rodar

openplc-web:

```bash
pnpm run example:dev        # página própria em http://localhost:5190
pnpm run example:check      # typecheck + lint + prettier + testes (Vitest)
pnpm run example:arch       # só a verificação de fronteiras
pnpm run example:e2e        # Playwright contra a página do exemplo
```

openplc-editor:

```bash
npm run example:check       # typecheck + lint + prettier + testes (Jest)
npm run example:arch
```

As configurações ficam fora desta pasta, na raiz de cada repositório (`tsconfig.example.json`, config de
testes e bloco do ESLint), porque runner e modo de módulos diferem entre os dois. Os testes usam apenas a API
comum a Vitest e Jest: sem `vi`/`jest`, sem matchers do jest-dom.

Para conferir que a pasta continua idêntica nos dois repositórios:

```bash
diff -r openplc-web/src_migration/example openplc-editor/src_migration/example
```

## Para criar uma feature nova seguindo o exemplo

1. Regras puras em `domain`, com testes sem React nem estado.
2. Contrato público em `contracts/application`; o caso de uso em `application` mapeia violações do domínio
   para erros do contrato e declara os ports de que precisa em `application/ports`.
3. Implementações dos ports em `state` e `infrastructure`.
4. Modelo de exibição e intenções em `contracts/presentation`; controller em `presentation`, com
   snapshots estáveis.
5. View em `frontend` usando só primitivas de `design-system`; fixture em `fixtures` para revisar a view
   sem a lógica real.
6. Binding em `react-bindings` e montagem em `composition`, incluindo o `dispose()`.
7. Rodar `example:arch`: a feature nova precisa passar pelas mesmas fronteiras.
