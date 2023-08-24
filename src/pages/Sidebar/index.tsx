import { FC } from 'react'
import { Outlet } from 'react-router-dom'

/**
 * Functional component representing a sidebar that renders the nested routes
 * @component
 */
const Sidebar: FC = () => {
  /**
   * Render the nested routes using the Outlet component from 'react-router-dom'
   * @returns JSX Element
   */
  return <Outlet />
}

export default Sidebar
