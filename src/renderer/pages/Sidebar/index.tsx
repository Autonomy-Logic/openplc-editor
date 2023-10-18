import { ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

/**
 * Functional component representing a sidebar that renders the nested routes
 * @component
 */
function Sidebar(): ReactNode {
  /**
   * Render the nested routes using the Outlet component from 'react-router-dom'
   * @returns JSX Element
   */
  return <Outlet />;
}

export default Sidebar;
