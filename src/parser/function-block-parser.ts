import { FunctionBlock, Parameter } from '../types/function-block';

export class FunctionBlockParser {
  parse(source: string): FunctionBlock[] {
    const functionBlocks: FunctionBlock[] = [];
    const lines = source.split('\n');
    let currentBlock: FunctionBlock | null = null;
    let inInterface = false;
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Check for function block declaration
      const fbMatch = trimmedLine.match(/^FUNCTION_BLOCK\s+(\w+)/);
      if (fbMatch) {
        currentBlock = {
          name: fbMatch[1],
          parameters: []
        };
        inInterface = false;
        continue;
      }
      
      // Check for interface section
      if (trimmedLine === 'VAR_INPUT' || trimmedLine === 'VAR_OUTPUT' || trimmedLine === 'VAR_IN_OUT') {
        inInterface = true;
        continue;
      }
      
      // End of interface section
      if (trimmedLine === 'END_VAR' && currentBlock) {
        inInterface = false;
        continue;
      }
      
      // Parse parameters within interface
      if (inInterface && currentBlock) {
        const param = this.parseParameter(trimmedLine);
        if (param) {
          currentBlock.parameters.push(param);
        }
      }
      
      // End of function block
      if (trimmedLine === 'END_FUNCTION_BLOCK' && currentBlock) {
        functionBlocks.push(currentBlock);
        currentBlock = null;
      }
    }
    
    return functionBlocks;
  }
  
  private parseParameter(line: string): Parameter | null {
    // Match parameter declaration: name: type := default_value;
    const paramMatch = line.match(/^([\w_]+)\s*:\s*([\w_]+)(?:\s*:=\s*(.+))?;$/);
    
    if (!paramMatch) {
      return null;
    }
    
    const [, name, type, defaultValue] = paramMatch;
    
    return {
      name,
      type,
      defaultValue: defaultValue ? defaultValue.trim() : undefined
    };
  }
}