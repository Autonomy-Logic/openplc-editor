import { createContext, FC, PropsWithChildren, useCallback, useMemo } from 'react';
import { Edge, Node } from 'reactflow';
import useUndoable, { MutationBehavior } from 'use-undoable';
import { v4 as uuid4 } from 'uuid';

export type ReactFlowElementsContextData = {
  nodes: Node[];
  getNode: (id: string) => Node | undefined;
  edges: Edge[];
  undo: () => void;
  redo: () => void;
  canRedo: boolean;
  canUndo: boolean;
  triggerUpdate: (
    element: 'nodes' | 'edges',
    value: Node[] | Edge[],
    behavior?: MutationBehavior,
    ignoreAction?: boolean
  ) => void;
};

export const ReactFlowElementsContext = createContext<ReactFlowElementsContextData>(
  {} as ReactFlowElementsContextData
);

const INITIAL_NODES: Node[] = [
  {
    id: uuid4(),
    type: 'powerRail',
    position: {
      x: 200,
      y: 200,
    },
    data: {
      pins: [
        {
          id: uuid4(),
          position: 'right',
        },
      ],
    },
  },
  {
    id: uuid4(),
    type: 'powerRail',
    position: {
      x: 800,
      y: 200,
    },
    data: {
      pins: [
        {
          id: uuid4(),
          position: 'left',
        },
      ],
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: uuid4(),
    type: 'default',
    source: INITIAL_NODES[0].id,
    target: INITIAL_NODES[1].id,
    sourceHandle: INITIAL_NODES[0].data.pins[0].id,
    targetHandle: INITIAL_NODES[1].data.pins[0].id,
  },
];
// Review this eslint rule
// eslint-disable-next-line react/function-component-definition
const ReactFlowElementsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [elements, setElements, { undo, redo, canRedo, canUndo }] = useUndoable(
    {
      edges: INITIAL_EDGES,
      nodes: INITIAL_NODES,
    },
    {
      ignoreIdenticalMutations: true,
      cloneState: true,
    }
  );

  const triggerUpdate = useCallback(
    (
      element: 'nodes' | 'edges',
      value: Node[] | Edge[],
      behavior?: MutationBehavior,
      ignoreAction?: boolean
    ) => {
      setElements(
        (state) => ({
          nodes: element === 'nodes' ? (value as Node[]) : state.nodes,
          edges: element === 'edges' ? (value as Edge[]) : state.edges,
        }),
        behavior,
        ignoreAction
      );
    },
    [setElements]
  );

  const getNode = useCallback(
    (id: string) => elements.nodes.find((node) => node.id === id),
    [elements.nodes]
  );
  /**
   * Memoize the default values.
   */
  const defaultValues = useMemo(
    () => ({
      ...elements,
      getNode,
      undo,
      redo,
      canRedo,
      canUndo,
      triggerUpdate,
    }),
    [elements, getNode, undo, redo, canRedo, canUndo, triggerUpdate]
  );
  return (
    <ReactFlowElementsContext.Provider value={defaultValues}>
      {children}
    </ReactFlowElementsContext.Provider>
  );
};

export default ReactFlowElementsProvider;
