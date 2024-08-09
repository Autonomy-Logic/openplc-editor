import { registerLanguage } from '../_.register';
import { conf as languageConfiguration, language as monarchLanguage } from './il';

// Mock the 'registerLanguage' function using Jest.
jest.mock('../_.register', () => ({
  registerLanguage: jest.fn(),
}));

// Function to register the IL language
function registerILLanguage() {
  registerLanguage({
    def: {
      id: 'il',
      extensions: ['.il'],
      aliases: ['IL', 'Instruction List'],
      mimetypes: ['text/instruction-list'],
    },
    conf: languageConfiguration,
    language: monarchLanguage,
  });
}

// Tests for IL language-related functionalities
describe('IL language tests', () => {
  it('should register IL language', () => {
    // Call the function that registers the IL language
    registerILLanguage();

    // Verify if the 'registerLanguage' function was called with the expected arguments
    expect(registerLanguage).toHaveBeenCalledWith({
      def: {
        id: 'il',
        extensions: ['.il'],
        aliases: ['IL', 'Instruction List'],
        mimetypes: ['text/instruction-list'],
      },
      conf: languageConfiguration,
      language: monarchLanguage,
    });
  });

  test('IL language configuration is valid', () => {
    // Validate the IL language configuration
    expect(languageConfiguration).toBeTruthy();
  });

  test('IL monarch language is valid', () => {
    // Validate the IL monarch language
    expect(monarchLanguage).toBeTruthy();
  });
});
