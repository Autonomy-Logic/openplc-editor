import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../../../../store/editorStore';
import { useProjectStore } from '../../../../store/projectStore';
import { Variable } from '../../../../types/project';
import { FBDNode, FBDWire, FBDElement } from '../../../../types/fbd';
import { generateNodeId } from '../../../../utils/idGenerator';
import { getVariableType } from '../../../../utils/variableUtils';
import FBDNodeComponent from './FBDNodeComponent';
import FBDWireComponent from './FBDWireComponent';
import FBDAutocomplete from './FBDAutocomplete';

interface FBDEditorProps {
  nodeId: string;
}

const FBDEditor: React.FC<FBDEditorProps> = ({ nodeId }) => {
  const { nodes, wires, updateNode, addNode, addWire, removeNode, removeWire } = useEditorStore();
  const { variables } = useProjectStore();
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggingWire, setDraggingWire] = useState<{ from: string; fromPort: string } | null>(null);
  const [autocompletePosition, setAutocompletePosition] = useState<{ x: number; y: number } | null>(null);
  const [autocompleteVariable, setAutocompleteVariable] = useState<string>('');
  const editorRef = useRef<HTMLDivElement>(null);

  const currentNode = nodes.find(n => n.id === nodeId);
  
  // Get all variables including struct members for autocomplete
  const getAllVariables = (): Variable[] => {
    const allVars: Variable[] = [];
    
    const addStructMembers = (variable: Variable, prefix: string = '') => {
      if (variable.type === 'STRUCT' && variable.structType) {
        variable.structType.fields.forEach(field => {
          const fullName = prefix ? `${prefix}.${field.name}` : field.name;
          allVars.push({
            ...field,
            name: fullName,
            id: `${variable.id}.${field.name}`
          });
          
          // Recursively add nested struct members
          if (field.type === 'STRUCT' && field.structType) {
            addStructMembers({
              ...field,
              name: fullName,
              id: `${variable.id}.${field.name}`
            }, fullName);
          }
        });
      }
    };
    
    variables.forEach(variable => {
      allVars.push(variable);
      addStructMembers(variable, variable.name);
    });
    
    return allVars;
  };

  const handleNodeSelect = (nodeId: string) => {
    setSelectedNode(nodeId);
  };

  const handleNodeMove = (nodeId: string, x: number, y: number) => {
    updateNode(nodeId, { x, y });
  };

  const handleWireStart = (from: string, fromPort: string) => {
    setDraggingWire({ from, fromPort });
  };

  const handleWireEnd = (to: string, toPort: string) => {
    if (draggingWire) {
      const newWire: FBDWire = {
        id: generateNodeId(),
        from: draggingWire.from,
        fromPort: draggingWire.fromPort,
        to,
        toPort,
      };
      addWire(newWire);
      setDraggingWire(null);
    }
  };

  const handleWireCancel = () => {
    setDraggingWire(null);
  };

  const handleAddNode = (type: string, x: number, y: number) => {
    const newNode: FBDNode = {
      id: generateNodeId(),
      type,
      x,
      y,
      inputs: [],
      outputs: [],
    };
    addNode(newNode);
  };

  const handleEditorClick = (e: React.MouseEvent) => {
    if (e.target === editorRef.current) {
      setSelectedNode(null);
      setAutocompletePosition(null);
    }
  };

  const handleVariableInput = (variable: string, x: number, y: number) => {
    setAutocompleteVariable(variable);
    setAutocompletePosition({ x, y });
  };

  const handleVariableSelect = (variable: string) => {
    // Handle variable selection
    setAutocompletePosition(null);
    setAutocompleteVariable('');
  };

  // Get CSS class for variable highlighting
  const getVariableClass = (variableName: string): string => {
    const variable = variables.find(v => v.name === variableName.split('.')[0]);
    if (!variable) return 'variable';
    
    // Check if it's a struct member
    if (variableName.includes('.')) {
      return 'struct-member';
    }
    
    return 'variable';
  };

  return (
    <div 
      ref={editorRef}
      className="fbd-editor"
      onClick={handleEditorClick}
    >
      {currentNode && (
        <FBDNodeComponent
          key={currentNode.id}
          node={currentNode}
          isSelected={selectedNode === currentNode.id}
          onSelect={handleNodeSelect}
          onMove={handleNodeMove}
          onWireStart={handleWireStart}
          onWireEnd={handleWireEnd}
          onVariableInput={handleVariableInput}
          getVariableClass={getVariableClass}
        />
      )}
      
      {wires.map(wire => (
        <FBDWireComponent
          key={wire.id}
          wire={wire}
          onCancel={handleWireCancel}
        />
      ))}
      
      {draggingWire && (
        <div 
          className="wire-drag-preview"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '100%',
            height: '100%',
            pointerEvents: 'none',
          }}
        />
      )}
      
      {autocompletePosition && (
        <FBDAutocomplete
          position={autocompletePosition}
          variables={getAllVariables()}
          onSelect={handleVariableSelect}
          filterText={autocompleteVariable}
        />
      )}
    </div>
  );
};

export default FBDEditor;