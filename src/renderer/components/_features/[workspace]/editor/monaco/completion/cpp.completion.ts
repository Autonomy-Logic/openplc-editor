import * as monaco from 'monaco-editor'

/**
 * C/C++ standard library functions completion provider
 * Provides autocomplete for common functions from stdio.h, stdlib.h, string.h, and math.h
 */
export const cppStandardLibraryCompletion = ({ range }: { range: monaco.IRange }) => {
  const stdioFunctions = [
    { name: 'printf', doc: 'Print formatted output to stdout', signature: 'printf(const char *format, ...)' },
    { name: 'scanf', doc: 'Read formatted input from stdin', signature: 'scanf(const char *format, ...)' },
    {
      name: 'fprintf',
      doc: 'Print formatted output to a file',
      signature: 'fprintf(FILE *stream, const char *format, ...)',
    },
    {
      name: 'fscanf',
      doc: 'Read formatted input from a file',
      signature: 'fscanf(FILE *stream, const char *format, ...)',
    },
    {
      name: 'sprintf',
      doc: 'Print formatted output to a string',
      signature: 'sprintf(char *str, const char *format, ...)',
    },
    {
      name: 'sscanf',
      doc: 'Read formatted input from a string',
      signature: 'sscanf(const char *str, const char *format, ...)',
    },
    { name: 'fopen', doc: 'Open a file', signature: 'fopen(const char *filename, const char *mode)' },
    { name: 'fclose', doc: 'Close a file', signature: 'fclose(FILE *stream)' },
    {
      name: 'fread',
      doc: 'Read data from a file',
      signature: 'fread(void *ptr, size_t size, size_t count, FILE *stream)',
    },
    {
      name: 'fwrite',
      doc: 'Write data to a file',
      signature: 'fwrite(const void *ptr, size_t size, size_t count, FILE *stream)',
    },
    { name: 'fgets', doc: 'Read a string from a file', signature: 'fgets(char *str, int n, FILE *stream)' },
    { name: 'fputs', doc: 'Write a string to a file', signature: 'fputs(const char *str, FILE *stream)' },
    { name: 'getchar', doc: 'Read a character from stdin', signature: 'getchar(void)' },
    { name: 'putchar', doc: 'Write a character to stdout', signature: 'putchar(int c)' },
    { name: 'puts', doc: 'Write a string to stdout', signature: 'puts(const char *str)' },
    { name: 'fseek', doc: 'Set file position', signature: 'fseek(FILE *stream, long offset, int whence)' },
    { name: 'ftell', doc: 'Get current file position', signature: 'ftell(FILE *stream)' },
    { name: 'rewind', doc: 'Reset file position to beginning', signature: 'rewind(FILE *stream)' },
  ]

  const stdlibFunctions = [
    { name: 'malloc', doc: 'Allocate memory', signature: 'malloc(size_t size)' },
    { name: 'calloc', doc: 'Allocate and zero-initialize memory', signature: 'calloc(size_t num, size_t size)' },
    { name: 'realloc', doc: 'Reallocate memory', signature: 'realloc(void *ptr, size_t size)' },
    { name: 'free', doc: 'Free allocated memory', signature: 'free(void *ptr)' },
    { name: 'exit', doc: 'Terminate program', signature: 'exit(int status)' },
    { name: 'abort', doc: 'Abort program execution', signature: 'abort(void)' },
    { name: 'atoi', doc: 'Convert string to integer', signature: 'atoi(const char *str)' },
    { name: 'atof', doc: 'Convert string to float', signature: 'atof(const char *str)' },
    { name: 'atol', doc: 'Convert string to long', signature: 'atol(const char *str)' },
    { name: 'rand', doc: 'Generate random number', signature: 'rand(void)' },
    { name: 'srand', doc: 'Seed random number generator', signature: 'srand(unsigned int seed)' },
    { name: 'abs', doc: 'Absolute value of integer', signature: 'abs(int n)' },
    { name: 'labs', doc: 'Absolute value of long', signature: 'labs(long n)' },
    {
      name: 'qsort',
      doc: 'Sort array',
      signature: 'qsort(void *base, size_t num, size_t size, int (*compar)(const void*, const void*))',
    },
    {
      name: 'bsearch',
      doc: 'Binary search in sorted array',
      signature:
        'bsearch(const void *key, const void *base, size_t num, size_t size, int (*compar)(const void*, const void*))',
    },
  ]

  const stringFunctions = [
    { name: 'strlen', doc: 'Get string length', signature: 'strlen(const char *str)' },
    { name: 'strcpy', doc: 'Copy string', signature: 'strcpy(char *dest, const char *src)' },
    {
      name: 'strncpy',
      doc: 'Copy n characters of string',
      signature: 'strncpy(char *dest, const char *src, size_t n)',
    },
    { name: 'strcat', doc: 'Concatenate strings', signature: 'strcat(char *dest, const char *src)' },
    {
      name: 'strncat',
      doc: 'Concatenate n characters of string',
      signature: 'strncat(char *dest, const char *src, size_t n)',
    },
    { name: 'strcmp', doc: 'Compare strings', signature: 'strcmp(const char *str1, const char *str2)' },
    {
      name: 'strncmp',
      doc: 'Compare n characters of strings',
      signature: 'strncmp(const char *str1, const char *str2, size_t n)',
    },
    { name: 'strchr', doc: 'Find character in string', signature: 'strchr(const char *str, int c)' },
    {
      name: 'strrchr',
      doc: 'Find last occurrence of character in string',
      signature: 'strrchr(const char *str, int c)',
    },
    { name: 'strstr', doc: 'Find substring', signature: 'strstr(const char *haystack, const char *needle)' },
    { name: 'strtok', doc: 'Tokenize string', signature: 'strtok(char *str, const char *delim)' },
    { name: 'memcpy', doc: 'Copy memory block', signature: 'memcpy(void *dest, const void *src, size_t n)' },
    { name: 'memmove', doc: 'Move memory block', signature: 'memmove(void *dest, const void *src, size_t n)' },
    { name: 'memset', doc: 'Fill memory block', signature: 'memset(void *ptr, int value, size_t n)' },
    { name: 'memcmp', doc: 'Compare memory blocks', signature: 'memcmp(const void *ptr1, const void *ptr2, size_t n)' },
  ]

  const mathFunctions = [
    { name: 'sin', doc: 'Sine function', signature: 'sin(double x)' },
    { name: 'cos', doc: 'Cosine function', signature: 'cos(double x)' },
    { name: 'tan', doc: 'Tangent function', signature: 'tan(double x)' },
    { name: 'asin', doc: 'Arc sine function', signature: 'asin(double x)' },
    { name: 'acos', doc: 'Arc cosine function', signature: 'acos(double x)' },
    { name: 'atan', doc: 'Arc tangent function', signature: 'atan(double x)' },
    { name: 'atan2', doc: 'Arc tangent of y/x', signature: 'atan2(double y, double x)' },
    { name: 'sqrt', doc: 'Square root', signature: 'sqrt(double x)' },
    { name: 'pow', doc: 'Power function', signature: 'pow(double base, double exp)' },
    { name: 'exp', doc: 'Exponential function', signature: 'exp(double x)' },
    { name: 'log', doc: 'Natural logarithm', signature: 'log(double x)' },
    { name: 'log10', doc: 'Base-10 logarithm', signature: 'log10(double x)' },
    { name: 'ceil', doc: 'Round up to nearest integer', signature: 'ceil(double x)' },
    { name: 'floor', doc: 'Round down to nearest integer', signature: 'floor(double x)' },
    { name: 'fabs', doc: 'Absolute value of float', signature: 'fabs(double x)' },
    { name: 'fmod', doc: 'Floating-point remainder', signature: 'fmod(double x, double y)' },
  ]

  const allFunctions = [...stdioFunctions, ...stdlibFunctions, ...stringFunctions, ...mathFunctions]

  const suggestions = allFunctions.map((func) => ({
    label: func.name,
    insertText: `${func.name}(\${1})`,
    documentation: `${func.doc}\n\nSignature: ${func.signature}`,
    kind: monaco.languages.CompletionItemKind.Function,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  }))

  return { suggestions }
}

/**
 * C/C++ code snippets completion provider
 * Provides common code patterns like if/else, loops, switch, etc.
 */
export const cppSnippetsCompletion = ({ range }: { range: monaco.IRange }) => {
  const snippets = [
    {
      label: 'if',
      insertText: 'if (${1:condition}) {\n\t${2}\n}',
      documentation: 'if statement',
    },
    {
      label: 'ifelse',
      insertText: 'if (${1:condition}) {\n\t${2}\n} else {\n\t${3}\n}',
      documentation: 'if-else statement',
    },
    {
      label: 'for',
      insertText: 'for (${1:int i = 0}; ${2:i < n}; ${3:i++}) {\n\t${4}\n}',
      documentation: 'for loop',
    },
    {
      label: 'while',
      insertText: 'while (${1:condition}) {\n\t${2}\n}',
      documentation: 'while loop',
    },
    {
      label: 'dowhile',
      insertText: 'do {\n\t${1}\n} while (${2:condition});',
      documentation: 'do-while loop',
    },
    {
      label: 'switch',
      insertText: 'switch (${1:expression}) {\n\tcase ${2:value}:\n\t\t${3}\n\t\tbreak;\n\tdefault:\n\t\t${4}\n}',
      documentation: 'switch statement',
    },
    {
      label: 'struct',
      insertText: 'struct ${1:name} {\n\t${2}\n};',
      documentation: 'struct definition',
    },
    {
      label: 'function',
      insertText: '${1:void} ${2:functionName}(${3}) {\n\t${4}\n}',
      documentation: 'function definition',
    },
  ]

  const suggestions = snippets.map((snippet) => ({
    label: snippet.label,
    insertText: snippet.insertText,
    documentation: snippet.documentation,
    kind: monaco.languages.CompletionItemKind.Snippet,
    insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
    range,
  }))

  return { suggestions }
}
