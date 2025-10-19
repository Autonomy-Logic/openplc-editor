import * as monaco from 'monaco-editor'

interface FunctionDef {
  name: string
  signature: string
  description: string
  returnValue: string
  params: Array<{ name: string; type: string; description: string }>
}

/**
 * C/C++ standard library functions completion provider
 * Function signatures and descriptions based on Linux man pages
 */
export const cppStandardLibraryCompletion = ({ range }: { range: monaco.IRange }) => {
  const stdioFunctions: FunctionDef[] = [
    {
      name: 'printf',
      signature: 'int printf(const char *format, ...)',
      description: 'Write formatted output to stdout',
      returnValue: 'Number of characters printed (excluding null byte), or negative value on error',
      params: [
        { name: 'format', type: 'const char *', description: 'Format string with conversion specifications' },
        { name: '...', type: 'variadic', description: 'Arguments corresponding to format specifiers' },
      ],
    },
    {
      name: 'fprintf',
      signature: 'int fprintf(FILE *stream, const char *format, ...)',
      description: 'Write formatted output to a stream',
      returnValue: 'Number of characters printed, or negative value on error',
      params: [
        { name: 'stream', type: 'FILE *', description: 'Output stream' },
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: '...', type: 'variadic', description: 'Arguments for format specifiers' },
      ],
    },
    {
      name: 'sprintf',
      signature: 'int sprintf(char *str, const char *format, ...)',
      description: 'Write formatted output to a string',
      returnValue: 'Number of characters written (excluding null byte)',
      params: [
        { name: 'str', type: 'char *', description: 'Destination buffer' },
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: '...', type: 'variadic', description: 'Arguments for format specifiers' },
      ],
    },
    {
      name: 'snprintf',
      signature: 'int snprintf(char *str, size_t size, const char *format, ...)',
      description: 'Write formatted output to a string with size limit',
      returnValue: 'Number of characters that would have been written (excluding null byte)',
      params: [
        { name: 'str', type: 'char *', description: 'Destination buffer' },
        { name: 'size', type: 'size_t', description: 'Maximum number of bytes to write' },
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: '...', type: 'variadic', description: 'Arguments for format specifiers' },
      ],
    },
    {
      name: 'scanf',
      signature: 'int scanf(const char *format, ...)',
      description: 'Read formatted input from stdin',
      returnValue: 'Number of input items successfully matched and assigned, or EOF on error',
      params: [
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: '...', type: 'variadic', description: 'Pointers to variables to store input' },
      ],
    },
    {
      name: 'fscanf',
      signature: 'int fscanf(FILE *stream, const char *format, ...)',
      description: 'Read formatted input from a stream',
      returnValue: 'Number of input items assigned, or EOF on error',
      params: [
        { name: 'stream', type: 'FILE *', description: 'Input stream' },
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: '...', type: 'variadic', description: 'Pointers to variables to store input' },
      ],
    },
    {
      name: 'sscanf',
      signature: 'int sscanf(const char *str, const char *format, ...)',
      description: 'Read formatted input from a string',
      returnValue: 'Number of input items assigned, or EOF on error',
      params: [
        { name: 'str', type: 'const char *', description: 'Input string' },
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: '...', type: 'variadic', description: 'Pointers to variables to store input' },
      ],
    },
    {
      name: 'fopen',
      signature: 'FILE *fopen(const char *pathname, const char *mode)',
      description: 'Open a file stream',
      returnValue: 'FILE pointer on success, NULL on error',
      params: [
        { name: 'pathname', type: 'const char *', description: 'Path to file' },
        { name: 'mode', type: 'const char *', description: 'Opening mode: "r", "w", "a", "r+", "w+", "a+"' },
      ],
    },
    {
      name: 'fclose',
      signature: 'int fclose(FILE *stream)',
      description: 'Close a file stream',
      returnValue: '0 on success, EOF on error',
      params: [{ name: 'stream', type: 'FILE *', description: 'Stream to close' }],
    },
    {
      name: 'fread',
      signature: 'size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream)',
      description: 'Read data from a stream',
      returnValue: 'Number of items successfully read',
      params: [
        { name: 'ptr', type: 'void *', description: 'Pointer to destination buffer' },
        { name: 'size', type: 'size_t', description: 'Size of each element in bytes' },
        { name: 'nmemb', type: 'size_t', description: 'Number of elements to read' },
        { name: 'stream', type: 'FILE *', description: 'Input stream' },
      ],
    },
    {
      name: 'fwrite',
      signature: 'size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream)',
      description: 'Write data to a stream',
      returnValue: 'Number of items successfully written',
      params: [
        { name: 'ptr', type: 'const void *', description: 'Pointer to source data' },
        { name: 'size', type: 'size_t', description: 'Size of each element in bytes' },
        { name: 'nmemb', type: 'size_t', description: 'Number of elements to write' },
        { name: 'stream', type: 'FILE *', description: 'Output stream' },
      ],
    },
    {
      name: 'fgets',
      signature: 'char *fgets(char *s, int size, FILE *stream)',
      description: 'Read a line from a stream',
      returnValue: 'Pointer to string on success, NULL on error or EOF',
      params: [
        { name: 's', type: 'char *', description: 'Destination buffer' },
        { name: 'size', type: 'int', description: 'Maximum number of characters to read' },
        { name: 'stream', type: 'FILE *', description: 'Input stream' },
      ],
    },
    {
      name: 'fputs',
      signature: 'int fputs(const char *s, FILE *stream)',
      description: 'Write a string to a stream',
      returnValue: 'Non-negative number on success, EOF on error',
      params: [
        { name: 's', type: 'const char *', description: 'String to write' },
        { name: 'stream', type: 'FILE *', description: 'Output stream' },
      ],
    },
    {
      name: 'fseek',
      signature: 'int fseek(FILE *stream, long offset, int whence)',
      description: 'Set file position indicator',
      returnValue: '0 on success, -1 on error',
      params: [
        { name: 'stream', type: 'FILE *', description: 'File stream' },
        { name: 'offset', type: 'long', description: 'Offset in bytes' },
        { name: 'whence', type: 'int', description: 'Reference position: SEEK_SET, SEEK_CUR, or SEEK_END' },
      ],
    },
    {
      name: 'ftell',
      signature: 'long ftell(FILE *stream)',
      description: 'Get current file position',
      returnValue: 'Current file position, or -1L on error',
      params: [{ name: 'stream', type: 'FILE *', description: 'File stream' }],
    },
    {
      name: 'rewind',
      signature: 'void rewind(FILE *stream)',
      description: 'Reset file position to beginning',
      returnValue: 'void',
      params: [{ name: 'stream', type: 'FILE *', description: 'File stream' }],
    },
    {
      name: 'getchar',
      signature: 'int getchar(void)',
      description: 'Read a character from stdin',
      returnValue: 'Character read as unsigned char cast to int, or EOF on error',
      params: [],
    },
    {
      name: 'putchar',
      signature: 'int putchar(int c)',
      description: 'Write a character to stdout',
      returnValue: 'Character written, or EOF on error',
      params: [{ name: 'c', type: 'int', description: 'Character to write' }],
    },
    {
      name: 'puts',
      signature: 'int puts(const char *s)',
      description: 'Write a string to stdout followed by newline',
      returnValue: 'Non-negative number on success, EOF on error',
      params: [{ name: 's', type: 'const char *', description: 'String to write' }],
    },
    {
      name: 'perror',
      signature: 'void perror(const char *s)',
      description: 'Print error message to stderr',
      returnValue: 'void',
      params: [{ name: 's', type: 'const char *', description: 'Custom message prefix' }],
    },
  ]

  const stdlibFunctions: FunctionDef[] = [
    {
      name: 'malloc',
      signature: 'void *malloc(size_t size)',
      description: 'Allocate dynamic memory',
      returnValue: 'Pointer to allocated memory, or NULL on failure',
      params: [{ name: 'size', type: 'size_t', description: 'Number of bytes to allocate' }],
    },
    {
      name: 'calloc',
      signature: 'void *calloc(size_t nmemb, size_t size)',
      description: 'Allocate and zero-initialize memory for an array',
      returnValue: 'Pointer to allocated memory, or NULL on failure',
      params: [
        { name: 'nmemb', type: 'size_t', description: 'Number of elements' },
        { name: 'size', type: 'size_t', description: 'Size of each element in bytes' },
      ],
    },
    {
      name: 'realloc',
      signature: 'void *realloc(void *ptr, size_t size)',
      description: 'Resize previously allocated memory',
      returnValue: 'Pointer to reallocated memory, or NULL on failure',
      params: [
        { name: 'ptr', type: 'void *', description: 'Pointer to previously allocated memory' },
        { name: 'size', type: 'size_t', description: 'New size in bytes' },
      ],
    },
    {
      name: 'free',
      signature: 'void free(void *ptr)',
      description: 'Free dynamically allocated memory',
      returnValue: 'void',
      params: [{ name: 'ptr', type: 'void *', description: 'Pointer to memory to free' }],
    },
    {
      name: 'exit',
      signature: 'void exit(int status)',
      description: 'Terminate the calling process',
      returnValue: 'Does not return',
      params: [{ name: 'status', type: 'int', description: 'Exit status (0 for success, non-zero for failure)' }],
    },
    {
      name: 'abort',
      signature: 'void abort(void)',
      description: 'Cause abnormal process termination',
      returnValue: 'Does not return',
      params: [],
    },
    {
      name: 'atoi',
      signature: 'int atoi(const char *nptr)',
      description: 'Convert string to integer',
      returnValue: 'Converted integer value',
      params: [{ name: 'nptr', type: 'const char *', description: 'String to convert' }],
    },
    {
      name: 'atof',
      signature: 'double atof(const char *nptr)',
      description: 'Convert string to double',
      returnValue: 'Converted double value',
      params: [{ name: 'nptr', type: 'const char *', description: 'String to convert' }],
    },
    {
      name: 'atol',
      signature: 'long atol(const char *nptr)',
      description: 'Convert string to long integer',
      returnValue: 'Converted long value',
      params: [{ name: 'nptr', type: 'const char *', description: 'String to convert' }],
    },
    {
      name: 'strtol',
      signature: 'long strtol(const char *nptr, char **endptr, int base)',
      description: 'Convert string to long integer with error checking',
      returnValue: 'Converted long value',
      params: [
        { name: 'nptr', type: 'const char *', description: 'String to convert' },
        { name: 'endptr', type: 'char **', description: 'Pointer to store address of first invalid character' },
        { name: 'base', type: 'int', description: 'Number base (2-36, or 0 for auto-detect)' },
      ],
    },
    {
      name: 'strtod',
      signature: 'double strtod(const char *nptr, char **endptr)',
      description: 'Convert string to double with error checking',
      returnValue: 'Converted double value',
      params: [
        { name: 'nptr', type: 'const char *', description: 'String to convert' },
        { name: 'endptr', type: 'char **', description: 'Pointer to store address of first invalid character' },
      ],
    },
    {
      name: 'rand',
      signature: 'int rand(void)',
      description: 'Generate pseudo-random integer',
      returnValue: 'Random integer between 0 and RAND_MAX',
      params: [],
    },
    {
      name: 'srand',
      signature: 'void srand(unsigned int seed)',
      description: 'Seed the random number generator',
      returnValue: 'void',
      params: [{ name: 'seed', type: 'unsigned int', description: 'Seed value' }],
    },
    {
      name: 'abs',
      signature: 'int abs(int j)',
      description: 'Compute absolute value of integer',
      returnValue: 'Absolute value of j',
      params: [{ name: 'j', type: 'int', description: 'Integer value' }],
    },
    {
      name: 'labs',
      signature: 'long labs(long j)',
      description: 'Compute absolute value of long integer',
      returnValue: 'Absolute value of j',
      params: [{ name: 'j', type: 'long', description: 'Long integer value' }],
    },
    {
      name: 'qsort',
      signature: 'void qsort(void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *))',
      description: 'Sort an array using quicksort algorithm',
      returnValue: 'void',
      params: [
        { name: 'base', type: 'void *', description: 'Pointer to array to sort' },
        { name: 'nmemb', type: 'size_t', description: 'Number of elements in array' },
        { name: 'size', type: 'size_t', description: 'Size of each element in bytes' },
        { name: 'compar', type: 'function pointer', description: 'Comparison function' },
      ],
    },
    {
      name: 'bsearch',
      signature:
        'void *bsearch(const void *key, const void *base, size_t nmemb, size_t size, int (*compar)(const void *, const void *))',
      description: 'Binary search in sorted array',
      returnValue: 'Pointer to matching element, or NULL if not found',
      params: [
        { name: 'key', type: 'const void *', description: 'Pointer to key to search for' },
        { name: 'base', type: 'const void *', description: 'Pointer to sorted array' },
        { name: 'nmemb', type: 'size_t', description: 'Number of elements in array' },
        { name: 'size', type: 'size_t', description: 'Size of each element in bytes' },
        { name: 'compar', type: 'function pointer', description: 'Comparison function' },
      ],
    },
    {
      name: 'getenv',
      signature: 'char *getenv(const char *name)',
      description: 'Get environment variable value',
      returnValue: 'Pointer to value string, or NULL if not found',
      params: [{ name: 'name', type: 'const char *', description: 'Environment variable name' }],
    },
    {
      name: 'system',
      signature: 'int system(const char *command)',
      description: 'Execute shell command',
      returnValue: 'Command exit status, or -1 on error',
      params: [{ name: 'command', type: 'const char *', description: 'Command to execute' }],
    },
  ]

  const stringFunctions: FunctionDef[] = [
    {
      name: 'strlen',
      signature: 'size_t strlen(const char *s)',
      description: 'Calculate length of string',
      returnValue: 'Number of bytes in string (excluding null terminator)',
      params: [{ name: 's', type: 'const char *', description: 'String to measure' }],
    },
    {
      name: 'strcpy',
      signature: 'char *strcpy(char *dest, const char *src)',
      description: 'Copy string',
      returnValue: 'Pointer to dest',
      params: [
        { name: 'dest', type: 'char *', description: 'Destination buffer' },
        { name: 'src', type: 'const char *', description: 'Source string' },
      ],
    },
    {
      name: 'strncpy',
      signature: 'char *strncpy(char *dest, const char *src, size_t n)',
      description: 'Copy at most n bytes of string',
      returnValue: 'Pointer to dest',
      params: [
        { name: 'dest', type: 'char *', description: 'Destination buffer' },
        { name: 'src', type: 'const char *', description: 'Source string' },
        { name: 'n', type: 'size_t', description: 'Maximum number of bytes to copy' },
      ],
    },
    {
      name: 'strcat',
      signature: 'char *strcat(char *dest, const char *src)',
      description: 'Concatenate strings',
      returnValue: 'Pointer to dest',
      params: [
        { name: 'dest', type: 'char *', description: 'Destination string' },
        { name: 'src', type: 'const char *', description: 'Source string to append' },
      ],
    },
    {
      name: 'strncat',
      signature: 'char *strncat(char *dest, const char *src, size_t n)',
      description: 'Concatenate at most n bytes of string',
      returnValue: 'Pointer to dest',
      params: [
        { name: 'dest', type: 'char *', description: 'Destination string' },
        { name: 'src', type: 'const char *', description: 'Source string to append' },
        { name: 'n', type: 'size_t', description: 'Maximum number of bytes to append' },
      ],
    },
    {
      name: 'strcmp',
      signature: 'int strcmp(const char *s1, const char *s2)',
      description: 'Compare two strings',
      returnValue: 'Negative if s1 < s2, 0 if equal, positive if s1 > s2',
      params: [
        { name: 's1', type: 'const char *', description: 'First string' },
        { name: 's2', type: 'const char *', description: 'Second string' },
      ],
    },
    {
      name: 'strncmp',
      signature: 'int strncmp(const char *s1, const char *s2, size_t n)',
      description: 'Compare at most n bytes of two strings',
      returnValue: 'Negative if s1 < s2, 0 if equal, positive if s1 > s2',
      params: [
        { name: 's1', type: 'const char *', description: 'First string' },
        { name: 's2', type: 'const char *', description: 'Second string' },
        { name: 'n', type: 'size_t', description: 'Maximum number of bytes to compare' },
      ],
    },
    {
      name: 'strchr',
      signature: 'char *strchr(const char *s, int c)',
      description: 'Locate first occurrence of character in string',
      returnValue: 'Pointer to matched character, or NULL if not found',
      params: [
        { name: 's', type: 'const char *', description: 'String to search' },
        { name: 'c', type: 'int', description: 'Character to find' },
      ],
    },
    {
      name: 'strrchr',
      signature: 'char *strrchr(const char *s, int c)',
      description: 'Locate last occurrence of character in string',
      returnValue: 'Pointer to matched character, or NULL if not found',
      params: [
        { name: 's', type: 'const char *', description: 'String to search' },
        { name: 'c', type: 'int', description: 'Character to find' },
      ],
    },
    {
      name: 'strstr',
      signature: 'char *strstr(const char *haystack, const char *needle)',
      description: 'Locate substring',
      returnValue: 'Pointer to beginning of substring, or NULL if not found',
      params: [
        { name: 'haystack', type: 'const char *', description: 'String to search in' },
        { name: 'needle', type: 'const char *', description: 'Substring to find' },
      ],
    },
    {
      name: 'strtok',
      signature: 'char *strtok(char *str, const char *delim)',
      description: 'Extract tokens from string',
      returnValue: 'Pointer to next token, or NULL if no more tokens',
      params: [
        { name: 'str', type: 'char *', description: 'String to tokenize (NULL for subsequent calls)' },
        { name: 'delim', type: 'const char *', description: 'Delimiter characters' },
      ],
    },
    {
      name: 'strdup',
      signature: 'char *strdup(const char *s)',
      description: 'Duplicate string (allocates memory)',
      returnValue: 'Pointer to duplicated string, or NULL on error',
      params: [{ name: 's', type: 'const char *', description: 'String to duplicate' }],
    },
    {
      name: 'memcpy',
      signature: 'void *memcpy(void *dest, const void *src, size_t n)',
      description: 'Copy memory area (non-overlapping)',
      returnValue: 'Pointer to dest',
      params: [
        { name: 'dest', type: 'void *', description: 'Destination memory' },
        { name: 'src', type: 'const void *', description: 'Source memory' },
        { name: 'n', type: 'size_t', description: 'Number of bytes to copy' },
      ],
    },
    {
      name: 'memmove',
      signature: 'void *memmove(void *dest, const void *src, size_t n)',
      description: 'Copy memory area (handles overlapping)',
      returnValue: 'Pointer to dest',
      params: [
        { name: 'dest', type: 'void *', description: 'Destination memory' },
        { name: 'src', type: 'const void *', description: 'Source memory' },
        { name: 'n', type: 'size_t', description: 'Number of bytes to copy' },
      ],
    },
    {
      name: 'memset',
      signature: 'void *memset(void *s, int c, size_t n)',
      description: 'Fill memory with constant byte',
      returnValue: 'Pointer to s',
      params: [
        { name: 's', type: 'void *', description: 'Memory to fill' },
        { name: 'c', type: 'int', description: 'Byte value to set' },
        { name: 'n', type: 'size_t', description: 'Number of bytes to set' },
      ],
    },
    {
      name: 'memcmp',
      signature: 'int memcmp(const void *s1, const void *s2, size_t n)',
      description: 'Compare memory areas',
      returnValue: 'Negative if s1 < s2, 0 if equal, positive if s1 > s2',
      params: [
        { name: 's1', type: 'const void *', description: 'First memory area' },
        { name: 's2', type: 'const void *', description: 'Second memory area' },
        { name: 'n', type: 'size_t', description: 'Number of bytes to compare' },
      ],
    },
  ]

  const mathFunctions: FunctionDef[] = [
    {
      name: 'sin',
      signature: 'double sin(double x)',
      description: 'Calculate sine',
      returnValue: 'Sine of x in radians',
      params: [{ name: 'x', type: 'double', description: 'Angle in radians' }],
    },
    {
      name: 'cos',
      signature: 'double cos(double x)',
      description: 'Calculate cosine',
      returnValue: 'Cosine of x in radians',
      params: [{ name: 'x', type: 'double', description: 'Angle in radians' }],
    },
    {
      name: 'tan',
      signature: 'double tan(double x)',
      description: 'Calculate tangent',
      returnValue: 'Tangent of x in radians',
      params: [{ name: 'x', type: 'double', description: 'Angle in radians' }],
    },
    {
      name: 'asin',
      signature: 'double asin(double x)',
      description: 'Calculate arc sine',
      returnValue: 'Arc sine of x in radians [-π/2, π/2]',
      params: [{ name: 'x', type: 'double', description: 'Value in range [-1, 1]' }],
    },
    {
      name: 'acos',
      signature: 'double acos(double x)',
      description: 'Calculate arc cosine',
      returnValue: 'Arc cosine of x in radians [0, π]',
      params: [{ name: 'x', type: 'double', description: 'Value in range [-1, 1]' }],
    },
    {
      name: 'atan',
      signature: 'double atan(double x)',
      description: 'Calculate arc tangent',
      returnValue: 'Arc tangent of x in radians [-π/2, π/2]',
      params: [{ name: 'x', type: 'double', description: 'Value' }],
    },
    {
      name: 'atan2',
      signature: 'double atan2(double y, double x)',
      description: 'Calculate arc tangent of y/x',
      returnValue: 'Arc tangent of y/x in radians [-π, π]',
      params: [
        { name: 'y', type: 'double', description: 'Y coordinate' },
        { name: 'x', type: 'double', description: 'X coordinate' },
      ],
    },
    {
      name: 'sqrt',
      signature: 'double sqrt(double x)',
      description: 'Calculate square root',
      returnValue: 'Square root of x',
      params: [{ name: 'x', type: 'double', description: 'Non-negative value' }],
    },
    {
      name: 'pow',
      signature: 'double pow(double x, double y)',
      description: 'Calculate power',
      returnValue: 'x raised to power y',
      params: [
        { name: 'x', type: 'double', description: 'Base' },
        { name: 'y', type: 'double', description: 'Exponent' },
      ],
    },
    {
      name: 'exp',
      signature: 'double exp(double x)',
      description: 'Calculate exponential',
      returnValue: 'e raised to power x',
      params: [{ name: 'x', type: 'double', description: 'Exponent' }],
    },
    {
      name: 'log',
      signature: 'double log(double x)',
      description: 'Calculate natural logarithm',
      returnValue: 'Natural logarithm of x',
      params: [{ name: 'x', type: 'double', description: 'Positive value' }],
    },
    {
      name: 'log10',
      signature: 'double log10(double x)',
      description: 'Calculate base-10 logarithm',
      returnValue: 'Base-10 logarithm of x',
      params: [{ name: 'x', type: 'double', description: 'Positive value' }],
    },
    {
      name: 'ceil',
      signature: 'double ceil(double x)',
      description: 'Round up to nearest integer',
      returnValue: 'Smallest integer not less than x',
      params: [{ name: 'x', type: 'double', description: 'Value to round' }],
    },
    {
      name: 'floor',
      signature: 'double floor(double x)',
      description: 'Round down to nearest integer',
      returnValue: 'Largest integer not greater than x',
      params: [{ name: 'x', type: 'double', description: 'Value to round' }],
    },
    {
      name: 'fabs',
      signature: 'double fabs(double x)',
      description: 'Calculate absolute value',
      returnValue: 'Absolute value of x',
      params: [{ name: 'x', type: 'double', description: 'Value' }],
    },
    {
      name: 'fmod',
      signature: 'double fmod(double x, double y)',
      description: 'Calculate floating-point remainder',
      returnValue: 'Remainder of x/y',
      params: [
        { name: 'x', type: 'double', description: 'Dividend' },
        { name: 'y', type: 'double', description: 'Divisor' },
      ],
    },
  ]

  const unistdFunctions: FunctionDef[] = [
    {
      name: 'read',
      signature: 'ssize_t read(int fd, void *buf, size_t count)',
      description: 'Read from file descriptor',
      returnValue: 'Number of bytes read, 0 on EOF, -1 on error',
      params: [
        { name: 'fd', type: 'int', description: 'File descriptor' },
        { name: 'buf', type: 'void *', description: 'Buffer to read into' },
        { name: 'count', type: 'size_t', description: 'Maximum bytes to read' },
      ],
    },
    {
      name: 'write',
      signature: 'ssize_t write(int fd, const void *buf, size_t count)',
      description: 'Write to file descriptor',
      returnValue: 'Number of bytes written, -1 on error',
      params: [
        { name: 'fd', type: 'int', description: 'File descriptor' },
        { name: 'buf', type: 'const void *', description: 'Buffer to write from' },
        { name: 'count', type: 'size_t', description: 'Number of bytes to write' },
      ],
    },
    {
      name: 'close',
      signature: 'int close(int fd)',
      description: 'Close file descriptor',
      returnValue: '0 on success, -1 on error',
      params: [{ name: 'fd', type: 'int', description: 'File descriptor to close' }],
    },
    {
      name: 'open',
      signature: 'int open(const char *pathname, int flags, mode_t mode)',
      description: 'Open file',
      returnValue: 'File descriptor on success, -1 on error',
      params: [
        { name: 'pathname', type: 'const char *', description: 'Path to file' },
        { name: 'flags', type: 'int', description: 'Access mode flags (O_RDONLY, O_WRONLY, O_RDWR, etc.)' },
        { name: 'mode', type: 'mode_t', description: 'File permissions (when creating)' },
      ],
    },
    {
      name: 'sleep',
      signature: 'unsigned int sleep(unsigned int seconds)',
      description: 'Sleep for specified number of seconds',
      returnValue: '0 if slept for full duration, remaining seconds if interrupted',
      params: [{ name: 'seconds', type: 'unsigned int', description: 'Number of seconds to sleep' }],
    },
    {
      name: 'usleep',
      signature: 'int usleep(useconds_t usec)',
      description: 'Sleep for specified number of microseconds',
      returnValue: '0 on success, -1 on error',
      params: [{ name: 'usec', type: 'useconds_t', description: 'Number of microseconds to sleep' }],
    },
    {
      name: 'fork',
      signature: 'pid_t fork(void)',
      description: 'Create child process',
      returnValue: '0 in child, child PID in parent, -1 on error',
      params: [],
    },
    {
      name: 'getpid',
      signature: 'pid_t getpid(void)',
      description: 'Get process ID',
      returnValue: 'Process ID of calling process',
      params: [],
    },
    {
      name: 'getppid',
      signature: 'pid_t getppid(void)',
      description: 'Get parent process ID',
      returnValue: 'Process ID of parent process',
      params: [],
    },
    {
      name: 'execl',
      signature: 'int execl(const char *pathname, const char *arg, ...)',
      description: 'Execute program',
      returnValue: 'Does not return on success, -1 on error',
      params: [
        { name: 'pathname', type: 'const char *', description: 'Path to executable' },
        { name: 'arg', type: 'const char *', description: 'First argument (program name)' },
        { name: '...', type: 'variadic', description: 'Additional arguments, NULL-terminated' },
      ],
    },
    {
      name: 'chdir',
      signature: 'int chdir(const char *path)',
      description: 'Change working directory',
      returnValue: '0 on success, -1 on error',
      params: [{ name: 'path', type: 'const char *', description: 'New working directory path' }],
    },
    {
      name: 'getcwd',
      signature: 'char *getcwd(char *buf, size_t size)',
      description: 'Get current working directory',
      returnValue: 'Pointer to buf on success, NULL on error',
      params: [
        { name: 'buf', type: 'char *', description: 'Buffer to store path' },
        { name: 'size', type: 'size_t', description: 'Size of buffer' },
      ],
    },
    {
      name: 'access',
      signature: 'int access(const char *pathname, int mode)',
      description: 'Check file accessibility',
      returnValue: '0 if accessible, -1 otherwise',
      params: [
        { name: 'pathname', type: 'const char *', description: 'Path to file' },
        { name: 'mode', type: 'int', description: 'Access mode: F_OK, R_OK, W_OK, X_OK' },
      ],
    },
  ]

  const pthreadFunctions: FunctionDef[] = [
    {
      name: 'pthread_create',
      signature:
        'int pthread_create(pthread_t *thread, const pthread_attr_t *attr, void *(*start_routine)(void *), void *arg)',
      description: 'Create new thread',
      returnValue: '0 on success, error number on failure',
      params: [
        { name: 'thread', type: 'pthread_t *', description: 'Pointer to thread identifier' },
        { name: 'attr', type: 'const pthread_attr_t *', description: 'Thread attributes (NULL for defaults)' },
        { name: 'start_routine', type: 'function pointer', description: 'Function to execute in thread' },
        { name: 'arg', type: 'void *', description: 'Argument to pass to start_routine' },
      ],
    },
    {
      name: 'pthread_join',
      signature: 'int pthread_join(pthread_t thread, void **retval)',
      description: 'Wait for thread termination',
      returnValue: '0 on success, error number on failure',
      params: [
        { name: 'thread', type: 'pthread_t', description: 'Thread to wait for' },
        { name: 'retval', type: 'void **', description: 'Pointer to store thread return value' },
      ],
    },
    {
      name: 'pthread_exit',
      signature: 'void pthread_exit(void *retval)',
      description: 'Terminate calling thread',
      returnValue: 'Does not return',
      params: [{ name: 'retval', type: 'void *', description: 'Return value' }],
    },
    {
      name: 'pthread_mutex_init',
      signature: 'int pthread_mutex_init(pthread_mutex_t *mutex, const pthread_mutexattr_t *attr)',
      description: 'Initialize mutex',
      returnValue: '0 on success, error number on failure',
      params: [
        { name: 'mutex', type: 'pthread_mutex_t *', description: 'Pointer to mutex' },
        { name: 'attr', type: 'const pthread_mutexattr_t *', description: 'Mutex attributes (NULL for defaults)' },
      ],
    },
    {
      name: 'pthread_mutex_lock',
      signature: 'int pthread_mutex_lock(pthread_mutex_t *mutex)',
      description: 'Lock mutex',
      returnValue: '0 on success, error number on failure',
      params: [{ name: 'mutex', type: 'pthread_mutex_t *', description: 'Pointer to mutex' }],
    },
    {
      name: 'pthread_mutex_unlock',
      signature: 'int pthread_mutex_unlock(pthread_mutex_t *mutex)',
      description: 'Unlock mutex',
      returnValue: '0 on success, error number on failure',
      params: [{ name: 'mutex', type: 'pthread_mutex_t *', description: 'Pointer to mutex' }],
    },
    {
      name: 'pthread_mutex_destroy',
      signature: 'int pthread_mutex_destroy(pthread_mutex_t *mutex)',
      description: 'Destroy mutex',
      returnValue: '0 on success, error number on failure',
      params: [{ name: 'mutex', type: 'pthread_mutex_t *', description: 'Pointer to mutex' }],
    },
  ]

  const timeFunctions: FunctionDef[] = [
    {
      name: 'time',
      signature: 'time_t time(time_t *tloc)',
      description: 'Get current time',
      returnValue: 'Current time as seconds since Epoch, -1 on error',
      params: [{ name: 'tloc', type: 'time_t *', description: 'Optional pointer to store time' }],
    },
    {
      name: 'clock',
      signature: 'clock_t clock(void)',
      description: 'Get processor time used',
      returnValue: 'Processor time used, -1 on error',
      params: [],
    },
    {
      name: 'difftime',
      signature: 'double difftime(time_t time1, time_t time0)',
      description: 'Calculate time difference',
      returnValue: 'Difference in seconds between time1 and time0',
      params: [
        { name: 'time1', type: 'time_t', description: 'End time' },
        { name: 'time0', type: 'time_t', description: 'Start time' },
      ],
    },
    {
      name: 'localtime',
      signature: 'struct tm *localtime(const time_t *timep)',
      description: 'Convert time to local time structure',
      returnValue: 'Pointer to tm structure, NULL on error',
      params: [{ name: 'timep', type: 'const time_t *', description: 'Pointer to time value' }],
    },
    {
      name: 'gmtime',
      signature: 'struct tm *gmtime(const time_t *timep)',
      description: 'Convert time to UTC time structure',
      returnValue: 'Pointer to tm structure, NULL on error',
      params: [{ name: 'timep', type: 'const time_t *', description: 'Pointer to time value' }],
    },
    {
      name: 'strftime',
      signature: 'size_t strftime(char *s, size_t max, const char *format, const struct tm *tm)',
      description: 'Format time as string',
      returnValue: 'Number of bytes written (excluding null byte), 0 if result too large',
      params: [
        { name: 's', type: 'char *', description: 'Destination buffer' },
        { name: 'max', type: 'size_t', description: 'Maximum size of buffer' },
        { name: 'format', type: 'const char *', description: 'Format string' },
        { name: 'tm', type: 'const struct tm *', description: 'Time structure' },
      ],
    },
    {
      name: 'nanosleep',
      signature: 'int nanosleep(const struct timespec *req, struct timespec *rem)',
      description: 'High-resolution sleep',
      returnValue: '0 on success, -1 on error',
      params: [
        { name: 'req', type: 'const struct timespec *', description: 'Requested sleep duration' },
        { name: 'rem', type: 'struct timespec *', description: 'Remaining time if interrupted' },
      ],
    },
  ]

  const signalFunctions: FunctionDef[] = [
    {
      name: 'signal',
      signature: 'sighandler_t signal(int signum, sighandler_t handler)',
      description: 'Set signal handler',
      returnValue: 'Previous signal handler, or SIG_ERR on error',
      params: [
        { name: 'signum', type: 'int', description: 'Signal number' },
        { name: 'handler', type: 'sighandler_t', description: 'Signal handler function' },
      ],
    },
    {
      name: 'raise',
      signature: 'int raise(int sig)',
      description: 'Send signal to current process',
      returnValue: '0 on success, non-zero on error',
      params: [{ name: 'sig', type: 'int', description: 'Signal number' }],
    },
    {
      name: 'kill',
      signature: 'int kill(pid_t pid, int sig)',
      description: 'Send signal to process',
      returnValue: '0 on success, -1 on error',
      params: [
        { name: 'pid', type: 'pid_t', description: 'Process ID' },
        { name: 'sig', type: 'int', description: 'Signal number' },
      ],
    },
  ]

  const allFunctions = [
    ...stdioFunctions,
    ...stdlibFunctions,
    ...stringFunctions,
    ...mathFunctions,
    ...unistdFunctions,
    ...pthreadFunctions,
    ...timeFunctions,
    ...signalFunctions,
  ]

  const suggestions = allFunctions.map((func) => {
    const paramDocs = func.params.map((p) => `  ${p.name} (${p.type}): ${p.description}`).join('\n')
    const documentation = `${func.description}\n\n${func.signature}\n\nParameters:\n${paramDocs || '  (none)'}\n\nReturns: ${func.returnValue}`

    return {
      label: func.name,
      insertText: `${func.name}(\${1})`,
      documentation,
      kind: monaco.languages.CompletionItemKind.Function,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
    }
  })

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
