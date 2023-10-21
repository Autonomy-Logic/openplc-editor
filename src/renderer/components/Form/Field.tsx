// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
// Review this eslint rule
/* eslint-disable react/function-component-definition */
import { FC, HTMLAttributes } from 'react';
/**
 * Props for the Field component.
 * Inherits HTML attributes for a `div` element.
 */
export type FieldProps = HTMLAttributes<HTMLDivElement>;
/**
 * Field component used to create a container for form fields.
 * @param props - Props for the Field component, inherits HTML attributes.
 */
const Field: FC<FieldProps> = (props) => {
  return <div className="flex flex-1 flex-col gap-1" {...props} />;
};

export default Field;
