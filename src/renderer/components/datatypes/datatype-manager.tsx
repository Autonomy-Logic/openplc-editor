import React, { useState, useEffect } from 'react';
import { Datatype } from '../../../types/datatype';
import { DatatypeList } from './datatype-list';
import { DatatypeEditor } from './datatype-editor';
import { deleteDatatype as deleteDatatypeAPI } from '../../../services/datatype-service';

interface DatatypeManagerProps {
  projectId: string;
}

export const DatatypeManager: React.FC<DatatypeManagerProps> = ({ projectId }) => {
  const [datatypes, setDatatypes] = useState<Datatype[]>([]);
  const [selectedDatatypeId, setSelectedDatatypeId] = useState<string | null>(null);
  const [editingDatatype, setEditingDatatype] = useState<Datatype | null>(null);

  useEffect(() => {
    // Load datatypes logic would go here
  }, [projectId]);

  const handleSelectDatatype = (datatypeId: string) => {
    setSelectedDatatypeId(datatypeId);
    const datatype = datatypes.find(d => d.id === datatypeId) || null;
    setEditingDatatype(datatype);
  };

  const handleDeleteDatatype = async (datatypeId: string) => {
    try {
      await deleteDatatypeAPI(datatypeId);
      setDatatypes(datatypes.filter(d => d.id !== datatypeId));
      
      if (selectedDatatypeId === datatypeId) {
        setSelectedDatatypeId(null);
        setEditingDatatype(null);
      }
    } catch (error) {
      console.error('Failed to delete datatype:', error);
    }
  };

  const handleCreateDatatype = () => {
    // Create new datatype logic
  };

  const handleUpdateDatatype = (updatedDatatype: Datatype) => {
    setDatatypes(datatypes.map(d => d.id === updatedDatatype.id ? updatedDatatype : d));
    setEditingDatatype(updatedDatatype);
  };

  return (
    <div className="datatype-manager">
      <DatatypeList 
        datatypes={datatypes}
        selectedDatatypeId={selectedDatatypeId}
        onSelectDatatype={handleSelectDatatype}
        onDeleteDatatype={handleDeleteDatatype}
        onCreateDatatype={handleCreateDatatype}
      />
      {editingDatatype && (
        <DatatypeEditor 
          datatype={editingDatatype}
          onUpdateDatatype={handleUpdateDatatype}
        />
      )}
    </div>
  );
};