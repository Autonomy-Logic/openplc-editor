import { createContext, FC, PropsWithChildren, useCallback } from 'react';
import { Edge, Node } from 'reactflow';
import useUndoable, { MutationBehavior } from 'use-undoable';

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
    ignoreAction?: boolean,
  ) => void;
};

export const ReactFlowElementsContext =
  createContext<ReactFlowElementsContextData>(
    {} as ReactFlowElementsContextData,
  );

const INITIAL_NODES: Node[] = [
  {
    id: crypto.randomUUID(),
    type: 'powerRail',
    position: {
      x: 200,
      y: 200,
    },
    data: {
      pins: [
        {
          id: crypto.randomUUID(),
          position: 'right',
        },
      ],
    },
  },
  {
    id: crypto.randomUUID(),
    type: 'powerRail',
    position: {
      x: 800,
      y: 200,
    },
    data: {
      pins: [
        {
          id: crypto.randomUUID(),
          position: 'left',
        },
      ],
    },
  },
];

const INITIAL_EDGES: Edge[] = [
  {
    id: crypto.randomUUID(),
    type: 'default',
    source: INITIAL_NODES[0].id,
    target: INITIAL_NODES[1].id,
    sourceHandle: INITIAL_NODES[0].data.pins[0].id,
    targetHandle: INITIAL_NODES[1].data.pins[0].id,
  },
];

const ReactFlowElementsProvider: FC<PropsWithChildren> = ({ children }) => {
  const [elements, setElements, { undo, redo, canRedo, canUndo }] = useUndoable(
    {
      edges: INITIAL_EDGES,
      nodes: INITIAL_NODES,
    },
    {
      ignoreIdenticalMutations: true,
      cloneState: true,
    },
  );

  const triggerUpdate = useCallback(
    (
      element: 'nodes' | 'edges',
      value: Node[] | Edge[],
      behavior?: MutationBehavior,
      ignoreAction?: boolean,
    ) => {
      setElements(
        (state) => ({
          nodes: element === 'nodes' ? (value as Node[]) : state.nodes,
          edges: element === 'edges' ? (value as Edge[]) : state.edges,
        }),
        behavior,
        ignoreAction,
      );
    },
    [setElements],
  );

  const getNode = useCallback(
    (id: string) => elements.nodes.find((node) => node.id === id),
    [elements.nodes],
  );

  return (
    <ReactFlowElementsContext.Provider
      value={{
        ...elements,
        getNode,
        undo,
        redo,
        canRedo,
        canUndo,
        triggerUpdate,
      }}
    >
      {children}
    </ReactFlowElementsContext.Provider>
  );
};

export default ReactFlowElementsProvider;
