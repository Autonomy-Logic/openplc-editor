import React from 'react';
import { Datatype } from '../../../types/datatype';
import { DatatypeItem } from './datatype-item';

interface DatatypeListProps {
  datatypes: Datatype[];
  onDelete: (id: string) => void;
  onEdit: (datatype: Datatype) => void;
}

export const DatatypeList: React.FC<DatatypeListProps> = ({ datatypes, onDelete, onEdit }) => {
  return (
    <div className="datatype-list">
      {datatypes.map((datatype) => (
        <DatatypeItem
          key={datatype.id}
          datatype={datatype}
          onDelete={() => onDelete(datatype.id)}
          onEdit={() => onEdit(datatype)}
        />
      ))}
    </div>
  );
};