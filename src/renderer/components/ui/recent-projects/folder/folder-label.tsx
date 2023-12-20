/* eslint-disable react/jsx-props-no-spreading */
import { HTMLAttributes, ReactElement } from 'react';

type TLabelProps = HTMLAttributes<HTMLParagraphElement> & {
  projectName: string;
  lastModified: string;
};

function Label({ projectName, lastModified, ...rest }: TLabelProps): ReactElement {
  return (
    <p id={projectName} {...rest}>
      <span id={projectName}>{projectName}</span>
      <span id={lastModified}>{lastModified}</span>
    </p>
  );
}

export default Label;
