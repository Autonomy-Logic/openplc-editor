// Mock the 'app' module
export const app = {
  getPath: jest.fn().mockReturnValue('/mock/path'), // Return a mock path
  isPackaged: false,
}
