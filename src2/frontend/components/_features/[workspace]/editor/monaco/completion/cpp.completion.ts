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
      command: {
        id: 'editor.action.triggerParameterHints',
        title: 'Trigger Parameter Hints',
      },
    }
  })

  return { suggestions, allFunctions }
}

/**
 * Arduino API functions completion provider
 * Comprehensive Arduino standard library functions
 */
export const arduinoApiCompletion = ({ range }: { range: monaco.IRange }) => {
  const arduinoCoreFunctions: FunctionDef[] = [
    {
      name: 'pinMode',
      signature: 'void pinMode(uint8_t pin, uint8_t mode)',
      description: 'Configure a pin as input or output',
      returnValue: 'void',
      params: [
        { name: 'pin', type: 'uint8_t', description: 'Pin number' },
        { name: 'mode', type: 'uint8_t', description: 'INPUT, OUTPUT, or INPUT_PULLUP' },
      ],
    },
    {
      name: 'digitalWrite',
      signature: 'void digitalWrite(uint8_t pin, uint8_t value)',
      description: 'Write a HIGH or LOW value to a digital pin',
      returnValue: 'void',
      params: [
        { name: 'pin', type: 'uint8_t', description: 'Pin number' },
        { name: 'value', type: 'uint8_t', description: 'HIGH or LOW' },
      ],
    },
    {
      name: 'digitalRead',
      signature: 'int digitalRead(uint8_t pin)',
      description: 'Read the value from a digital pin',
      returnValue: 'HIGH or LOW',
      params: [{ name: 'pin', type: 'uint8_t', description: 'Pin number' }],
    },
    {
      name: 'analogRead',
      signature: 'int analogRead(uint8_t pin)',
      description: 'Read the value from an analog pin',
      returnValue: '0 to 1023 (10-bit resolution)',
      params: [{ name: 'pin', type: 'uint8_t', description: 'Analog pin number' }],
    },
    {
      name: 'analogWrite',
      signature: 'void analogWrite(uint8_t pin, int value)',
      description: 'Write an analog value (PWM wave) to a pin',
      returnValue: 'void',
      params: [
        { name: 'pin', type: 'uint8_t', description: 'Pin number' },
        { name: 'value', type: 'int', description: 'Duty cycle: 0 (off) to 255 (fully on)' },
      ],
    },
    {
      name: 'analogReference',
      signature: 'void analogReference(uint8_t mode)',
      description: 'Configure the reference voltage for analog input',
      returnValue: 'void',
      params: [{ name: 'mode', type: 'uint8_t', description: 'DEFAULT, INTERNAL, EXTERNAL' }],
    },
    {
      name: 'millis',
      signature: 'unsigned long millis(void)',
      description: 'Returns milliseconds since program started',
      returnValue: 'Number of milliseconds',
      params: [],
    },
    {
      name: 'micros',
      signature: 'unsigned long micros(void)',
      description: 'Returns microseconds since program started',
      returnValue: 'Number of microseconds',
      params: [],
    },
    {
      name: 'delay',
      signature: 'void delay(unsigned long ms)',
      description: 'Pause the program for specified milliseconds',
      returnValue: 'void',
      params: [{ name: 'ms', type: 'unsigned long', description: 'Milliseconds to pause' }],
    },
    {
      name: 'delayMicroseconds',
      signature: 'void delayMicroseconds(unsigned int us)',
      description: 'Pause the program for specified microseconds',
      returnValue: 'void',
      params: [{ name: 'us', type: 'unsigned int', description: 'Microseconds to pause' }],
    },
    {
      name: 'map',
      signature: 'long map(long value, long fromLow, long fromHigh, long toLow, long toHigh)',
      description: 'Re-map a number from one range to another',
      returnValue: 'Mapped value',
      params: [
        { name: 'value', type: 'long', description: 'Value to map' },
        { name: 'fromLow', type: 'long', description: 'Lower bound of input range' },
        { name: 'fromHigh', type: 'long', description: 'Upper bound of input range' },
        { name: 'toLow', type: 'long', description: 'Lower bound of output range' },
        { name: 'toHigh', type: 'long', description: 'Upper bound of output range' },
      ],
    },
    {
      name: 'constrain',
      signature: 'long constrain(long x, long a, long b)',
      description: 'Constrain a number to be within a range',
      returnValue: 'Constrained value',
      params: [
        { name: 'x', type: 'long', description: 'Value to constrain' },
        { name: 'a', type: 'long', description: 'Lower bound' },
        { name: 'b', type: 'long', description: 'Upper bound' },
      ],
    },
    {
      name: 'min',
      signature: 'long min(long a, long b)',
      description: 'Return the smaller of two numbers',
      returnValue: 'Minimum value',
      params: [
        { name: 'a', type: 'long', description: 'First value' },
        { name: 'b', type: 'long', description: 'Second value' },
      ],
    },
    {
      name: 'max',
      signature: 'long max(long a, long b)',
      description: 'Return the larger of two numbers',
      returnValue: 'Maximum value',
      params: [
        { name: 'a', type: 'long', description: 'First value' },
        { name: 'b', type: 'long', description: 'Second value' },
      ],
    },
    {
      name: 'sq',
      signature: 'long sq(long x)',
      description: 'Calculate the square of a number',
      returnValue: 'Square of x',
      params: [{ name: 'x', type: 'long', description: 'Value to square' }],
    },
    {
      name: 'random',
      signature: 'long random(long max)',
      description: 'Generate a random number',
      returnValue: 'Random number from 0 to max-1',
      params: [{ name: 'max', type: 'long', description: 'Upper bound (exclusive)' }],
    },
    {
      name: 'randomSeed',
      signature: 'void randomSeed(unsigned long seed)',
      description: 'Initialize the random number generator',
      returnValue: 'void',
      params: [{ name: 'seed', type: 'unsigned long', description: 'Seed value' }],
    },
    {
      name: 'bit',
      signature: 'uint8_t bit(uint8_t n)',
      description: 'Compute the value of the specified bit',
      returnValue: 'Value of bit n',
      params: [{ name: 'n', type: 'uint8_t', description: 'Bit position (0-7)' }],
    },
    {
      name: 'bitRead',
      signature: 'uint8_t bitRead(uint8_t value, uint8_t bit)',
      description: 'Read a bit of a number',
      returnValue: '0 or 1',
      params: [
        { name: 'value', type: 'uint8_t', description: 'Number to read from' },
        { name: 'bit', type: 'uint8_t', description: 'Bit position to read' },
      ],
    },
    {
      name: 'bitWrite',
      signature: 'void bitWrite(uint8_t &value, uint8_t bit, uint8_t bitvalue)',
      description: 'Write a bit of a numeric variable',
      returnValue: 'void',
      params: [
        { name: 'value', type: 'uint8_t &', description: 'Number to modify' },
        { name: 'bit', type: 'uint8_t', description: 'Bit position to write' },
        { name: 'bitvalue', type: 'uint8_t', description: 'Value to write (0 or 1)' },
      ],
    },
    {
      name: 'bitSet',
      signature: 'void bitSet(uint8_t &value, uint8_t bit)',
      description: 'Set (write 1 to) a bit of a numeric variable',
      returnValue: 'void',
      params: [
        { name: 'value', type: 'uint8_t &', description: 'Number to modify' },
        { name: 'bit', type: 'uint8_t', description: 'Bit position to set' },
      ],
    },
    {
      name: 'bitClear',
      signature: 'void bitClear(uint8_t &value, uint8_t bit)',
      description: 'Clear (write 0 to) a bit of a numeric variable',
      returnValue: 'void',
      params: [
        { name: 'value', type: 'uint8_t &', description: 'Number to modify' },
        { name: 'bit', type: 'uint8_t', description: 'Bit position to clear' },
      ],
    },
    {
      name: 'lowByte',
      signature: 'uint8_t lowByte(uint16_t value)',
      description: 'Extract the low-order byte of a word',
      returnValue: 'Low byte',
      params: [{ name: 'value', type: 'uint16_t', description: 'Word value' }],
    },
    {
      name: 'highByte',
      signature: 'uint8_t highByte(uint16_t value)',
      description: 'Extract the high-order byte of a word',
      returnValue: 'High byte',
      params: [{ name: 'value', type: 'uint16_t', description: 'Word value' }],
    },
    {
      name: 'attachInterrupt',
      signature: 'void attachInterrupt(uint8_t interrupt, void (*ISR)(void), int mode)',
      description: 'Attach an interrupt handler to a pin',
      returnValue: 'void',
      params: [
        { name: 'interrupt', type: 'uint8_t', description: 'Interrupt number' },
        { name: 'ISR', type: 'function pointer', description: 'Interrupt service routine' },
        { name: 'mode', type: 'int', description: 'RISING, FALLING, CHANGE, LOW' },
      ],
    },
    {
      name: 'detachInterrupt',
      signature: 'void detachInterrupt(uint8_t interrupt)',
      description: 'Detach an interrupt handler',
      returnValue: 'void',
      params: [{ name: 'interrupt', type: 'uint8_t', description: 'Interrupt number' }],
    },
    {
      name: 'interrupts',
      signature: 'void interrupts(void)',
      description: 'Re-enable interrupts',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'noInterrupts',
      signature: 'void noInterrupts(void)',
      description: 'Disable interrupts',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'tone',
      signature: 'void tone(uint8_t pin, unsigned int frequency)',
      description: 'Generate a square wave of specified frequency on a pin',
      returnValue: 'void',
      params: [
        { name: 'pin', type: 'uint8_t', description: 'Pin number' },
        { name: 'frequency', type: 'unsigned int', description: 'Frequency in Hz' },
      ],
    },
    {
      name: 'noTone',
      signature: 'void noTone(uint8_t pin)',
      description: 'Stop tone generation on a pin',
      returnValue: 'void',
      params: [{ name: 'pin', type: 'uint8_t', description: 'Pin number' }],
    },
    {
      name: 'pulseIn',
      signature: 'unsigned long pulseIn(uint8_t pin, uint8_t state)',
      description: 'Read a pulse duration on a pin',
      returnValue: 'Pulse duration in microseconds',
      params: [
        { name: 'pin', type: 'uint8_t', description: 'Pin number' },
        { name: 'state', type: 'uint8_t', description: 'HIGH or LOW' },
      ],
    },
    {
      name: 'shiftOut',
      signature: 'void shiftOut(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder, uint8_t value)',
      description: 'Shift out a byte of data one bit at a time',
      returnValue: 'void',
      params: [
        { name: 'dataPin', type: 'uint8_t', description: 'Data pin' },
        { name: 'clockPin', type: 'uint8_t', description: 'Clock pin' },
        { name: 'bitOrder', type: 'uint8_t', description: 'MSBFIRST or LSBFIRST' },
        { name: 'value', type: 'uint8_t', description: 'Byte to shift out' },
      ],
    },
    {
      name: 'shiftIn',
      signature: 'uint8_t shiftIn(uint8_t dataPin, uint8_t clockPin, uint8_t bitOrder)',
      description: 'Shift in a byte of data one bit at a time',
      returnValue: 'Byte value',
      params: [
        { name: 'dataPin', type: 'uint8_t', description: 'Data pin' },
        { name: 'clockPin', type: 'uint8_t', description: 'Clock pin' },
        { name: 'bitOrder', type: 'uint8_t', description: 'MSBFIRST or LSBFIRST' },
      ],
    },
  ]

  const arduinoSerialFunctions: FunctionDef[] = [
    {
      name: 'Serial.begin',
      signature: 'void Serial.begin(unsigned long baud)',
      description: 'Initialize serial communication',
      returnValue: 'void',
      params: [{ name: 'baud', type: 'unsigned long', description: 'Baud rate (e.g., 9600, 115200)' }],
    },
    {
      name: 'Serial.end',
      signature: 'void Serial.end(void)',
      description: 'Disable serial communication',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'Serial.available',
      signature: 'int Serial.available(void)',
      description: 'Get number of bytes available for reading',
      returnValue: 'Number of bytes available',
      params: [],
    },
    {
      name: 'Serial.read',
      signature: 'int Serial.read(void)',
      description: 'Read a byte from serial buffer',
      returnValue: 'First byte of incoming data, or -1 if none available',
      params: [],
    },
    {
      name: 'Serial.peek',
      signature: 'int Serial.peek(void)',
      description: 'Read a byte without removing it from buffer',
      returnValue: 'First byte of incoming data, or -1 if none available',
      params: [],
    },
    {
      name: 'Serial.write',
      signature: 'size_t Serial.write(uint8_t val)',
      description: 'Write binary data to serial port',
      returnValue: 'Number of bytes written',
      params: [{ name: 'val', type: 'uint8_t', description: 'Byte to write' }],
    },
    {
      name: 'Serial.print',
      signature: 'size_t Serial.print(const char *str)',
      description: 'Print data to serial port as human-readable ASCII text',
      returnValue: 'Number of bytes written',
      params: [{ name: 'str', type: 'const char *', description: 'Data to print' }],
    },
    {
      name: 'Serial.println',
      signature: 'size_t Serial.println(const char *str)',
      description: 'Print data to serial port followed by newline',
      returnValue: 'Number of bytes written',
      params: [{ name: 'str', type: 'const char *', description: 'Data to print' }],
    },
    {
      name: 'Serial.flush',
      signature: 'void Serial.flush(void)',
      description: 'Wait for transmission of outgoing serial data to complete',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'Serial.readString',
      signature: 'String Serial.readString(void)',
      description: 'Read characters from serial buffer into a String',
      returnValue: 'String object',
      params: [],
    },
    {
      name: 'Serial.readStringUntil',
      signature: 'String Serial.readStringUntil(char terminator)',
      description: 'Read characters until terminator character',
      returnValue: 'String object',
      params: [{ name: 'terminator', type: 'char', description: 'Terminator character' }],
    },
    {
      name: 'Serial.parseInt',
      signature: 'long Serial.parseInt(void)',
      description: 'Parse integer from serial buffer',
      returnValue: 'Parsed integer value',
      params: [],
    },
    {
      name: 'Serial.parseFloat',
      signature: 'float Serial.parseFloat(void)',
      description: 'Parse float from serial buffer',
      returnValue: 'Parsed float value',
      params: [],
    },
  ]

  const arduinoWireFunctions: FunctionDef[] = [
    {
      name: 'Wire.begin',
      signature: 'void Wire.begin(void)',
      description: 'Initialize I2C communication as master',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'Wire.beginTransmission',
      signature: 'void Wire.beginTransmission(uint8_t address)',
      description: 'Begin transmission to I2C slave device',
      returnValue: 'void',
      params: [{ name: 'address', type: 'uint8_t', description: '7-bit I2C address' }],
    },
    {
      name: 'Wire.endTransmission',
      signature: 'uint8_t Wire.endTransmission(void)',
      description: 'End transmission to I2C slave device',
      returnValue: '0: success, 1-4: various errors',
      params: [],
    },
    {
      name: 'Wire.requestFrom',
      signature: 'uint8_t Wire.requestFrom(uint8_t address, uint8_t quantity)',
      description: 'Request bytes from I2C slave device',
      returnValue: 'Number of bytes returned',
      params: [
        { name: 'address', type: 'uint8_t', description: '7-bit I2C address' },
        { name: 'quantity', type: 'uint8_t', description: 'Number of bytes to request' },
      ],
    },
    {
      name: 'Wire.write',
      signature: 'size_t Wire.write(uint8_t data)',
      description: 'Write data to I2C slave device',
      returnValue: 'Number of bytes written',
      params: [{ name: 'data', type: 'uint8_t', description: 'Byte to write' }],
    },
    {
      name: 'Wire.available',
      signature: 'int Wire.available(void)',
      description: 'Get number of bytes available for reading',
      returnValue: 'Number of bytes available',
      params: [],
    },
    {
      name: 'Wire.read',
      signature: 'int Wire.read(void)',
      description: 'Read a byte from I2C',
      returnValue: 'Byte read, or -1 if none available',
      params: [],
    },
  ]

  const arduinoSpiFunctions: FunctionDef[] = [
    {
      name: 'SPI.begin',
      signature: 'void SPI.begin(void)',
      description: 'Initialize SPI bus',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'SPI.end',
      signature: 'void SPI.end(void)',
      description: 'Disable SPI bus',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'SPI.transfer',
      signature: 'uint8_t SPI.transfer(uint8_t data)',
      description: 'Transfer one byte over SPI',
      returnValue: 'Byte received',
      params: [{ name: 'data', type: 'uint8_t', description: 'Byte to send' }],
    },
    {
      name: 'SPI.beginTransaction',
      signature: 'void SPI.beginTransaction(SPISettings settings)',
      description: 'Initialize SPI transaction',
      returnValue: 'void',
      params: [{ name: 'settings', type: 'SPISettings', description: 'SPI settings object' }],
    },
    {
      name: 'SPI.endTransaction',
      signature: 'void SPI.endTransaction(void)',
      description: 'End SPI transaction',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'SPI.setBitOrder',
      signature: 'void SPI.setBitOrder(uint8_t bitOrder)',
      description: 'Set bit order for SPI',
      returnValue: 'void',
      params: [{ name: 'bitOrder', type: 'uint8_t', description: 'MSBFIRST or LSBFIRST' }],
    },
    {
      name: 'SPI.setDataMode',
      signature: 'void SPI.setDataMode(uint8_t mode)',
      description: 'Set SPI data mode',
      returnValue: 'void',
      params: [{ name: 'mode', type: 'uint8_t', description: 'SPI_MODE0, SPI_MODE1, SPI_MODE2, or SPI_MODE3' }],
    },
    {
      name: 'SPI.setClockDivider',
      signature: 'void SPI.setClockDivider(uint8_t divider)',
      description: 'Set SPI clock divider',
      returnValue: 'void',
      params: [{ name: 'divider', type: 'uint8_t', description: 'Clock divider value' }],
    },
  ]

  const arduinoEepromFunctions: FunctionDef[] = [
    {
      name: 'EEPROM.read',
      signature: 'uint8_t EEPROM.read(int address)',
      description: 'Read a byte from EEPROM',
      returnValue: 'Byte value',
      params: [{ name: 'address', type: 'int', description: 'EEPROM address' }],
    },
    {
      name: 'EEPROM.write',
      signature: 'void EEPROM.write(int address, uint8_t value)',
      description: 'Write a byte to EEPROM',
      returnValue: 'void',
      params: [
        { name: 'address', type: 'int', description: 'EEPROM address' },
        { name: 'value', type: 'uint8_t', description: 'Byte to write' },
      ],
    },
    {
      name: 'EEPROM.update',
      signature: 'void EEPROM.update(int address, uint8_t value)',
      description: 'Write a byte to EEPROM only if different',
      returnValue: 'void',
      params: [
        { name: 'address', type: 'int', description: 'EEPROM address' },
        { name: 'value', type: 'uint8_t', description: 'Byte to write' },
      ],
    },
    {
      name: 'EEPROM.get',
      signature: 'T& EEPROM.get(int address, T &data)',
      description: 'Read any data type from EEPROM',
      returnValue: 'Reference to data',
      params: [
        { name: 'address', type: 'int', description: 'EEPROM address' },
        { name: 'data', type: 'T &', description: 'Variable to store data' },
      ],
    },
    {
      name: 'EEPROM.put',
      signature: 'const T& EEPROM.put(int address, const T &data)',
      description: 'Write any data type to EEPROM',
      returnValue: 'Reference to data',
      params: [
        { name: 'address', type: 'int', description: 'EEPROM address' },
        { name: 'data', type: 'const T &', description: 'Data to write' },
      ],
    },
    {
      name: 'EEPROM.length',
      signature: 'int EEPROM.length(void)',
      description: 'Get EEPROM size',
      returnValue: 'EEPROM size in bytes',
      params: [],
    },
  ]

  const arduinoWifiFunctions: FunctionDef[] = [
    {
      name: 'WiFi.begin',
      signature: 'int WiFi.begin(const char *ssid, const char *password)',
      description: 'Connect to WiFi network',
      returnValue: 'Connection status',
      params: [
        { name: 'ssid', type: 'const char *', description: 'Network SSID' },
        { name: 'password', type: 'const char *', description: 'Network password' },
      ],
    },
    {
      name: 'WiFi.disconnect',
      signature: 'void WiFi.disconnect(void)',
      description: 'Disconnect from WiFi network',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'WiFi.status',
      signature: 'uint8_t WiFi.status(void)',
      description: 'Get WiFi connection status',
      returnValue: 'WL_CONNECTED, WL_DISCONNECTED, etc.',
      params: [],
    },
    {
      name: 'WiFi.localIP',
      signature: 'IPAddress WiFi.localIP(void)',
      description: 'Get local IP address',
      returnValue: 'IPAddress object',
      params: [],
    },
    {
      name: 'WiFi.macAddress',
      signature: 'uint8_t* WiFi.macAddress(uint8_t *mac)',
      description: 'Get MAC address',
      returnValue: 'Pointer to MAC address array',
      params: [{ name: 'mac', type: 'uint8_t *', description: '6-byte array to store MAC' }],
    },
    {
      name: 'WiFi.SSID',
      signature: 'String WiFi.SSID(void)',
      description: 'Get current network SSID',
      returnValue: 'SSID string',
      params: [],
    },
    {
      name: 'WiFi.RSSI',
      signature: 'long WiFi.RSSI(void)',
      description: 'Get signal strength',
      returnValue: 'Signal strength in dBm',
      params: [],
    },
  ]

  const arduinoEthernetFunctions: FunctionDef[] = [
    {
      name: 'Ethernet.begin',
      signature: 'int Ethernet.begin(uint8_t *mac)',
      description: 'Initialize Ethernet with DHCP',
      returnValue: '1 on success, 0 on failure',
      params: [{ name: 'mac', type: 'uint8_t *', description: 'MAC address (6 bytes)' }],
    },
    {
      name: 'Ethernet.localIP',
      signature: 'IPAddress Ethernet.localIP(void)',
      description: 'Get local IP address',
      returnValue: 'IPAddress object',
      params: [],
    },
    {
      name: 'Ethernet.linkStatus',
      signature: 'uint8_t Ethernet.linkStatus(void)',
      description: 'Get link status',
      returnValue: 'LinkON, LinkOFF, or Unknown',
      params: [],
    },
  ]

  const arduinoServomotorFunctions: FunctionDef[] = [
    {
      name: 'Servo.attach',
      signature: 'uint8_t Servo.attach(int pin)',
      description: 'Attach servo to a pin',
      returnValue: 'Servo index',
      params: [{ name: 'pin', type: 'int', description: 'Pin number' }],
    },
    {
      name: 'Servo.detach',
      signature: 'void Servo.detach(void)',
      description: 'Detach servo from pin',
      returnValue: 'void',
      params: [],
    },
    {
      name: 'Servo.write',
      signature: 'void Servo.write(int angle)',
      description: 'Set servo angle',
      returnValue: 'void',
      params: [{ name: 'angle', type: 'int', description: 'Angle in degrees (0-180)' }],
    },
    {
      name: 'Servo.writeMicroseconds',
      signature: 'void Servo.writeMicroseconds(int us)',
      description: 'Set servo pulse width',
      returnValue: 'void',
      params: [{ name: 'us', type: 'int', description: 'Pulse width in microseconds' }],
    },
    {
      name: 'Servo.read',
      signature: 'int Servo.read(void)',
      description: 'Read current servo angle',
      returnValue: 'Current angle in degrees',
      params: [],
    },
    {
      name: 'Servo.attached',
      signature: 'bool Servo.attached(void)',
      description: 'Check if servo is attached',
      returnValue: 'true if attached, false otherwise',
      params: [],
    },
  ]

  const allArduinoFunctions = [
    ...arduinoCoreFunctions,
    ...arduinoSerialFunctions,
    ...arduinoWireFunctions,
    ...arduinoSpiFunctions,
    ...arduinoEepromFunctions,
    ...arduinoWifiFunctions,
    ...arduinoEthernetFunctions,
    ...arduinoServomotorFunctions,
  ]

  const suggestions = allArduinoFunctions.map((func) => {
    const paramDocs = func.params.map((p) => `  ${p.name} (${p.type}): ${p.description}`).join('\n')
    const documentation = `${func.description}\n\n${func.signature}\n\nParameters:\n${paramDocs || '  (none)'}\n\nReturns: ${func.returnValue}`

    return {
      label: func.name,
      insertText: `${func.name}(\${1})`,
      documentation,
      kind: monaco.languages.CompletionItemKind.Function,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      range,
      command: {
        id: 'editor.action.triggerParameterHints',
        title: 'Trigger Parameter Hints',
      },
    }
  })

  return { suggestions, allFunctions: allArduinoFunctions }
}

/**
 * C/C++ signature help provider
 * Provides parameter hints when typing function calls
 */
export const cppSignatureHelp: monaco.languages.SignatureHelpProvider = {
  provideSignatureHelp: (
    model: monaco.editor.ITextModel,
    position: monaco.Position,
  ): monaco.languages.ProviderResult<monaco.languages.SignatureHelpResult> => {
    const { allFunctions: stdFunctions } = cppStandardLibraryCompletion({ range: new monaco.Range(0, 0, 0, 0) })
    const { allFunctions: arduinoFunctions } = arduinoApiCompletion({ range: new monaco.Range(0, 0, 0, 0) })
    const allFunctions = [...stdFunctions, ...arduinoFunctions]

    const textUntilPosition = model.getValueInRange({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    })

    const functionCallMatch = textUntilPosition.match(/(\w+(?:\.\w+)*)\s*\([^)]*$/)
    if (!functionCallMatch) {
      return null
    }

    const functionName = functionCallMatch[1]
    const func = allFunctions.find((f) => f.name === functionName)

    if (!func) {
      return null
    }

    const textAfterFunctionName = textUntilPosition.substring(functionCallMatch.index! + functionCallMatch[0].length)
    const commaCount = (textAfterFunctionName.match(/,/g) || []).length
    const activeParameter = commaCount

    const parameters: monaco.languages.ParameterInformation[] = func.params.map((param) => ({
      label: `${param.name}: ${param.type}`,
      documentation: param.description,
    }))

    const signatureInfo: monaco.languages.SignatureInformation = {
      label: func.signature,
      documentation: {
        value: `${func.description}\n\n**Returns:** ${func.returnValue}`,
      },
      parameters,
    }

    return {
      value: {
        signatures: [signatureInfo],
        activeSignature: 0,
        activeParameter: Math.min(activeParameter, parameters.length - 1),
      },
      dispose: () => {},
    }
  },
  signatureHelpTriggerCharacters: ['(', ','],
  signatureHelpRetriggerCharacters: [','],
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
