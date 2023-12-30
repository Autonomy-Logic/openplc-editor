import { HTMLAttributes, ReactNode } from 'react';

type CarouselViewportProps = HTMLAttributes<HTMLDivElement> & {
  exampleProjects?: object[];
};
/**
 * Renders a viewport component.
 *
 * @param {CarouselViewportProps} props - The properties for the component.
 * @return {ReactNode} The rendered component.
 */
export default function Viewport(props: CarouselViewportProps): ReactNode {
  return <div className='flex gap-4' {...props} />;
}
