import { CompletionItem, CompletionItemKind } from 'vscode-languageserver-types';

export interface FunctionBlockParameter {
  name: string;
  type: string;
  documentation?: string;
  defaultValue?: string;
}

export class CompletionWidget {
  private container: HTMLElement;

  constructor() {
    this.container = document.createElement('div');
    this.container.className = 'completion-widget';
    this.container.style.display = 'none';
    this.container.style.position = 'absolute';
    this.container.style.zIndex = '1000';
    this.container.style.backgroundColor = 'white';
    this.container.style.border = '1px solid #ccc';
    this.container.style.borderRadius = '4px';
    this.container.style.boxShadow = '0 2px 8px rgba(0,0,0,0.1)';
    this.container.style.maxHeight = '300px';
    this.container.style.overflowY = 'auto';
  }

  show(items: CompletionItem[], position: { x: number; y: number }): void {
    this.container.innerHTML = '';
    
    items.forEach(item => {
      const element = document.createElement('div');
      element.className = 'completion-item';
      element.style.padding = '8px 12px';
      element.style.cursor = 'pointer';
      element.style.borderBottom = '1px solid #eee';
      
      element.addEventListener('mouseenter', () => {
        element.style.backgroundColor = '#f0f0f0';
      });
      
      element.addEventListener('mouseleave', () => {
        element.style.backgroundColor = 'white';
      });
      
      const label = document.createElement('div');
      label.style.fontWeight = 'bold';
      label.textContent = item.label;
      
      const detail = document.createElement('div');
      detail.style.fontSize = '0.9em';
      detail.style.color = '#666';
      detail.textContent = item.detail || '';
      
      if (item.documentation) {
        const doc = document.createElement('div');
        doc.style.fontSize = '0.8em';
        doc.style.color = '#888';
        doc.style.marginTop = '4px';
        
        if (typeof item.documentation === 'string') {
          doc.textContent = item.documentation;
        } else if (typeof item.documentation === 'object' && item.documentation.value) {
          doc.textContent = item.documentation.value;
        }
        
        element.appendChild(label);
        element.appendChild(detail);
        element.appendChild(doc);
      } else {
        element.appendChild(label);
        element.appendChild(detail);
      }
      
      this.container.appendChild(element);
    });
    
    this.container.style.left = `${position.x}px`;
    this.container.style.top = `${position.y}px`;
    this.container.style.display = 'block';
  }

  hide(): void {
    this.container.style.display = 'none';
  }

  isVisible(): boolean {
    return this.container.style.display === 'block';
  }

  getElement(): HTMLElement {
    return this.container;
  }

  renderFunctionBlockParameters(parameters: FunctionBlockParameter[]): string {
    return parameters.map(param => {
      const defaultValue = param.defaultValue ? ` := ${param.defaultValue}` : '';
      return `${param.name}: ${param.type}${defaultValue}`;
    }).join('; ');
  }
}

export function createCompletionWidget(): CompletionWidget {
  return new CompletionWidget();
}