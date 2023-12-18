import '@testing-library/jest-dom';

import { cleanup, render, screen } from '@testing-library/react';
import { RouterProvider } from 'renderer/providers';

afterEach(cleanup);

describe('test suite for start layout', () => {
  /**
   * Test cases
   */
  it('should render start layout component', () => {
    render(<RouterProvider />);
    expect(screen.getByText('Start Layout')).toBeInTheDocument();
  });
});
