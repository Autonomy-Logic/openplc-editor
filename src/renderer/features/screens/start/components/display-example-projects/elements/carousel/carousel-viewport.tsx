import { HTMLAttributes, ReactNode } from 'react';

export type ExampleCarouselViewportProps = HTMLAttributes<HTMLDivElement> & {
  exampleProjects?: object[];
};
/**
 * Renders a viewport component.
 *
 * @param {ExampleCarouselViewportProps} props - The properties for the component.
 * @return {ReactNode} The rendered component.
 */
export default function Viewport(props: ExampleCarouselViewportProps): ReactNode {
  return <div className='flex ' {...props} />;
}

export type ExampleCarouselViewport = typeof Viewport;
