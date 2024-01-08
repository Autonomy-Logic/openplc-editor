/* eslint-disable react/jsx-props-no-spreading */
import { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/utils';

type SearchRootProps = HTMLAttributes<HTMLDivElement>;

export default function Root({ className, ...props }: SearchRootProps): ReactNode {
  return <div className={cn(className)} {...props} />;
}
