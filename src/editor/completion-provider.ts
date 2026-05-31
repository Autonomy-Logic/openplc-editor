import * as vscode from 'vscode';
import { TextDocument, Position, CompletionItem, CompletionItemKind, Range } from 'vscode';

export class FunctionBlockParameterCompletionProvider implements vscode.CompletionItemProvider {
  
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
    
    const lineText = document.lineAt(position).text.substring(0, position.character);
    
    // Check if we're in a function block instantiation context
    // Looking for pattern like: fb_instance : FUNCTION_BLOCK_NAME (
    const functionBlockPattern = /([a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\(\s*$/;
    const match = lineText.match(functionBlockPattern);
    
    if (!match) {
      return [];
    }
    
    const instanceName = match[1];
    const functionBlockName = match[2];
    
    // In a real implementation, we would look up the function block definition
    // and extract parameter names. For now, we'll return a sample completion.
    // TODO: Implement actual function block parameter lookup
    const parameterNames = ['INPUT1', 'INPUT2', 'OUTPUT1'];
    
    const completionItems = parameterNames.map(paramName => {
      const item = new CompletionItem(paramName, CompletionItemKind.Field);
      item.detail = `Parameter of ${functionBlockName}`;
      return item;
    });
    
    return completionItems;
  }
}

export function registerFunctionBlockParameterCompletionProvider(): vscode.Disposable {
  return vscode.languages.registerCompletionItemProvider(
    'st', // Assuming 'st' is the language identifier for Structured Text
    new FunctionBlockParameterCompletionProvider(),
    '(',
    ','
  );
}