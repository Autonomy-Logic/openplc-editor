// Review this eslint rule
/* eslint-disable react/function-component-definition */
import { FC } from 'react';
import { useFormContext } from 'react-hook-form';

/**
 * Props for the ErrorMessage component.
 */
type ErrorMessageProps = {
  field: string;
};
/**
 * Get a nested property value from an object using a dot-separated path.
 * @param obj - The object to traverse.
 * @param path - The dot-separated path of the nested property.
 * @returns The value of the nested property, or undefined if not found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const get = (obj: Record<any, any>, path: string) => {
  const travel = (regexp: RegExp) =>
    String.prototype.split
      .call(path, regexp)
      .filter(Boolean)
      .reduce(
        (res, key) => (res !== null && res !== undefined ? res[key] : res),
        obj,
      );

  const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/);

  return result;
};
/**
 * ErrorMessage component to display validation error messages for form fields.
 * @param field - The name of the field to display the error message for.
 */
const ErrorMessage: FC<ErrorMessageProps> = ({ field }) => {
  const {
    formState: { errors },
  } = useFormContext();

  const fieldError = get(errors, field);

  if (!fieldError) {
    return <div className="mt-1 h-4" />;
  }

  return (
    <span className="mt-1 text-xs text-red-500">
      {fieldError.message?.toString()}
    </span>
  );
};

export default ErrorMessage;
