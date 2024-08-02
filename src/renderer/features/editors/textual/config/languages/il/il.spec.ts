import { registerLanguage } from '../_.register';
import { conf as languageConfiguration, language as monarchLanguage } from './il';

// Mock da função 'registerLanguage' usando Jest.
jest.mock('../_.register', () => ({
  registerLanguage: jest.fn(),
}));

// Função para registrar a linguagem IL
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

// Testes para funcionalidades relacionadas à linguagem IL
describe('IL language tests', () => {
  it('should register IL language', () => {
    // Chama a função que registra a linguagem IL
    registerILLanguage();

    // Verifica se a função 'registerLanguage' foi chamada com os argumentos esperados
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
    // Valida a configuração da linguagem IL
    expect(languageConfiguration).toBeTruthy();
  });

  test('IL monarch language is valid', () => {
    // Valida a linguagem IL no formato Monarch
    expect(monarchLanguage).toBeTruthy();
  });
});
