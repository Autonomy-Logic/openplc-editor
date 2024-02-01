import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Editor from './index';
import { useOpenPLCStore } from '~/renderer/store';

// Mocking useOpenPLCStore
jest.mock('~/renderer/store', () => ({
  useOpenPLCStore: {
    useProjectData: jest.fn(),
    useProjectPath: jest.fn(),
  },
}));

// Mocking useLocation
jest.mock('react-router-dom', () => ({
  useLocation: jest.fn(),
}));

describe('Editor Component', () => {
  it('renders Editor component with default values', () => {
    // Mocking hook responses
    (useOpenPLCStore.useProjectData as jest.Mock).mockReturnValue(null);
    (useOpenPLCStore.useProjectPath as jest.Mock).mockReturnValue('');

    // Render the component
    render(<Editor />);

    // Assert
    expect(screen.getByText(/Path:/)).toBeInTheDocument();
    expect(screen.getByText(/Data:/)).toBeInTheDocument();
  });
});
