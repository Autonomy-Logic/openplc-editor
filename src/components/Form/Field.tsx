import React, { HTMLAttributes } from 'react';

export type FieldProps = HTMLAttributes<HTMLDivElement>;

const Field: React.FC<FieldProps> = (props) => {
  return <div className="flex flex-1 flex-col gap-1" {...props} />;
};

export default Field;
