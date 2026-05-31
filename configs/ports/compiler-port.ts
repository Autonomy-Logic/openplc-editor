import { CompilerPort } from './compiler-port.interface';
import { CompilationRequest, CompilationResult } from '../../types';

export class CompilerPortImpl implements CompilerPort {
  async compile(request: CompilationRequest): Promise<CompilationResult> {
    // Preprocess ST programs to ensure they end with newline
    const processedSources = request.sources.map(source => {
      if (source.language === 'ST' && !source.content.endsWith('\n')) {
        return {
          ...source,
          content: source.content + '\n'
        };
      }
      return source;
    });

    // Forward to actual compilation with processed sources
    return this.doCompile({
      ...request,
      sources: processedSources
    });
  }

  private async doCompile(request: CompilationRequest): Promise<CompilationResult> {
    // Actual compilation implementation would go here
    // This is a placeholder that simply returns success
    return {
      success: true,
      output: 'Compilation successful',
      errors: []
    };
  }
}
