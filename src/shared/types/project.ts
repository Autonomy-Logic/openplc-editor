export interface ExportableElement {
  id: string;
  type: string;
  name: string;
  description?: string;
}

export interface XmlStructure {
  root: string;
  version: string;
  encoding?: string;
  elements: ExportableElement[];
}

export interface ExportOptions {
  includeMetadata: boolean;
  format: 'xml' | 'json' | 'csv';
  compress: boolean;
  encryption?: string;
}

export interface ExportConfiguration {
  projectId: string;
  targetPath: string;
  options: ExportOptions;
  selectedElements: string[];
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  timestamp: number;
}