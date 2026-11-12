import { addInoPrototypes } from '../steps/ino-prototypes'

const FILE = 'examples/Baremetal/Baremetal.ino'

describe('addInoPrototypes', () => {
  it('declares a function before the first definition, so the sketch can call one defined further down', () => {
    const sketch = [
      '#include "defines.h"',
      '',
      'void setup()',
      '{',
      '    later(1);',
      '}',
      '',
      'int later(int x)',
      '{',
      '    return x;',
      '}',
    ].join('\n')

    const out = addInoPrototypes(sketch, FILE).split('\n')

    expect(out.slice(0, 5)).toEqual([
      '#include "defines.h"',
      '',
      'int later(int x);',
      `#line 3 "${FILE}"`,
      'void setup()',
    ])
  })

  it('leaves setup and loop alone, and returns the sketch unchanged when nothing else is defined', () => {
    const sketch = 'void setup() {}\nvoid loop() {}\n'
    expect(addInoPrototypes(sketch, FILE)).toBe(sketch)
  })

  it('keeps the preprocessor conditions a definition sits in, including #else branches', () => {
    const sketch = [
      'void setup() { modbusTask(); }',
      '#ifdef MODBUS_ENABLED',
      'void modbusTask() {}',
      '#endif',
      '#if defined(A)',
      'void onA() {}',
      '#else',
      'void notA() {}',
      '#endif',
    ].join('\n')

    const out = addInoPrototypes(sketch, FILE)

    expect(out).toContain(['#ifdef MODBUS_ENABLED', 'void modbusTask();', '#endif'].join('\n'))
    expect(out).toContain(['#if defined(A)', 'void onA();', '#endif'].join('\n'))
    expect(out).toContain(['#if defined(A)', '#else', 'void notA();', '#endif'].join('\n'))
  })

  it('inserts before the outermost #if when the first definition is conditional', () => {
    const sketch = [
      '#include "a.h"',
      '#ifdef X',
      '#ifdef Y',
      'void inner() {}',
      '#endif',
      '#endif',
      'void setup() {}',
    ].join('\n')

    const out = addInoPrototypes(sketch, FILE).split('\n')

    expect(out.slice(0, 7)).toEqual([
      '#include "a.h"',
      '#ifdef X',
      '#ifdef Y',
      'void inner();',
      '#endif',
      '#endif',
      `#line 2 "${FILE}"`,
    ])
  })

  it('finds a definition whose brace opens on the next line, with pointers, references and const', () => {
    const sketch = [
      'static inline uint32_t slack()',
      '{ return 0; }',
      'char *name(const char &c)',
      '{ return 0; }',
      'void setup() {}',
    ].join('\n')

    const out = addInoPrototypes(sketch, FILE)

    expect(out).toContain('static inline uint32_t slack();')
    expect(out).toContain('char * name(const char &c);')
  })

  it('skips default arguments, templates, operators, methods, types and initialisers', () => {
    const sketch = [
      'void withDefault(int x = 1) {}',
      'template <typename T> T twice(T x) { return x; }',
      'void operator delete(void* ptr, unsigned int) {}',
      'void Klass::method() {}',
      'struct Point { int x; };',
      'int table[] = { 1, 2 };',
      'extern "C" { void inC() {} }',
      'void setup() {}',
    ].join('\n')

    expect(addInoPrototypes(sketch, FILE)).toBe(sketch)
  })

  it('ignores braces and parentheses inside comments and string literals', () => {
    const sketch = [
      '// void fake() {',
      '/* int alsoFake(int) { */',
      'const char *banner = "void notAFunction() {";',
      "void real() { const char c = '{'; }",
      'void setup() {}',
    ].join('\n')

    const out = addInoPrototypes(sketch, FILE)

    expect(out).toContain('void real();')
    expect(out).not.toContain('fake();')
    expect(out).not.toContain('notAFunction();')
  })

  it('reads a directive continued over several lines as one', () => {
    const sketch = ['#if defined(A) || \\', '    defined(B)', 'void either() {}', '#endif', 'void setup() {}'].join(
      '\n',
    )

    expect(addInoPrototypes(sketch, FILE)).toContain(
      ['#if defined(A) || \\', '    defined(B)', 'void either();', '#endif'].join('\n'),
    )
  })
})
