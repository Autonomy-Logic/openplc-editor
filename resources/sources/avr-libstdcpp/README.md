# avr-libstdcpp: libstdc++ port for avr-gcc
[![Build Status](https://github.com/modm-io/avr-libstdcpp/actions/workflows/compile_examples.yml/badge.svg)](https://github.com/modm-io/avr-libstdcpp/actions)
==================

`avr-libstdcpp` is a partial, non-fully-tested
implementation of the C++ standard library and its STL.
It is intended to be used with `avr-gcc`.

Many features of modern C++11,14,17 and 20 are supported.

`avr-gcc` does not have a complete C++ standard library nor does it include an STL implementation.
The `avr-libstdcpp` port (even though not-fully-tested
and only partially full/complete) will, nonetheless,
be useful for those interested in making more comprehensive utilization
of C++, including its standard library, with a modern `avr-gcc` compiler.

## Historical origins

The `avr-libstdcpp` library traces its own origins to existing
GNU/GCC C++ standard library implementation(s), themselves targeting
embedded systems. This work is essentially an even-more
_embedded_-_friendly_ adaptation of the aforementioned work.

The `avr-libstdcpp` port began in 2018 with an initial import
of a GNU/GCC-based C++ standard library from GCC 8.
A second import of a GNU/GCC-based C++ standard library from GCC 10
in 2020 modernized the port to include many contemporary C++20 features.

## Using the library

- Add the `avr-libstdcpp/include` path to the standard `-isystem` (or `-I`) include path(s) of the compiler on the command line.
- Upon doing this, include standard library headers in the usual way (i.e., `#include <algorithm>`,  `#include <array>`,  `#include <cstdint>`, etc.).
- There are also several source files located in the [src directory](./src). Some of these may potentially be needed.
- For instance, when doing floating-point mathematical calculations with the `<cmath>` library, the file [`math.cc`](./src/math.cc) located [here](./src) needs to be added as a normal source file to your project.


For straightforward header-only use, for example,
simply add the `-isystem` (or alternatively the `-I`) include path
to your particular location of `avr-libstdcpp/include` on the command line...

```sh
avr-g++ -O2 -x c++ -isystem /my_path/avr-libstdcpp/include -mmcu=atmega328p test.cpp -o test.elf
```

... and seamlessly use standard library headers in your code.

```cpp
#include <array>
#include <numeric>

std::array<int, 3U> a { 1, 2, 3 };

int main()
{
  // 6
  auto sum = std::accumulate(a.cbegin(), a.cend(), 0);

  static_cast<void>(sum);
}
```

Additional straightforward code samples exercising standard library usage
can be found in the [examples](./examples) folder.

## Using the library with MICROCHIP's ATMEL Studio

`avr-libstdcpp` can be successfully used with MICROCHIP's ATMEL Studio.
The include path of the headers needs to be added to the project settings in the normal way.
Add also any of the necessary source files, as described in the section above.

This is an advanced use of `avr-libstdcpp` in combination with MICROCHIP's ATMEL Studio
because the underlying GCC compiler used with ATMEL Studio also needs to be
upgraded to a much more modern one than the `avr-gcc` 5
delivered in the standard installation of this studio.

An [informative thread](https://github.com/modm-io/avr-libstdcpp/issues/17#issuecomment-1098241768)
provides a few more details on how to use `avr-libstdcpp` with MICROCHIP's ATMEL Studio.

## Guidance for tiny bare-metal systems

### Very helpful go-to libraries

In general the C++ standard library is intended
to be written and implemented in a resource-sensitive
fashion. This includes efforts to save on both
memory as well as run-time.
In fact, C++ standard library functions and algorithms
have, in general, been specifically written and tuned by
the library authors with efficiency aspects in mind.
In particular, library components compile reliably and quickly
and also lend themselves well to compiler optimization.

Some library components, however, are particularly well-suited
for bare-metal microcontroller programming.
These can be exceptionally helpful when used properly and sensibly
in tiny bare-metal microcontroller environments.

A subjective list of these the libraries/headers
and their main uses includes, but is not limited to,:

- `<array>` for containers having known, fixed size.
- `<algorithm>` for standard algorithms such as sorting, minimax, sequential operations, etc.
- `<cmath>` for projects requiring floating-point mathematical functions such as `std::sin()`, `std::exp()`, `std::frexp()` and many more. For some mathematical uses, it might be necessary to include [`math.cc`](./src/math.cc) in your project. This source file is located [here](./src).
- `<cstdint>` which defines integral types having specified widths residing within `namespace std` like `std::uint8_t`.
- `<limits>` offering compile-time query of numeric limits of built-in types.
- `<numeric>` featuring a collection of useful numeric algorithms such as `std::accumulate()`, etc.
- `<type_traits>` for compile-time decisions based on types.

With these libraries alone, the entire project can benefit
from a great deal of the standard library's power without compromising
in any way on performance or sleek memory footprint.
This is because these libaries are typically lean, fast and require no additional storage.

The following non-trivial, real-world example, for instance,
wraps instances of an overly-simplified LED class abstraction
as object-references in an `std::array`.
Once stored, the application exercises the LED's toggle
function in an algorithmic loop with `toggle()`-method call
expressed via lambda function.

```cpp
#include <algorithm>
#include <array>
#include <type_traits>

class led
{
public:
  led() = default;

  auto toggle() -> void { }
};

led led0;
led led1;
led led2;

using led_ref_type = std::reference_wrapper<led>;

std::array<led_ref_type, 3U> led_refs =
{
  led0,
  led1,
  led2
};

int main()
{
  for(;;)
  {
    std::for_each(led_refs.begin(),
                  led_refs.end(),
                  [](led& lr) { lr.toggle(); });
  }
}
```

This nifty little example is terse, expressive and powerful.
It makes use of parts of `<algorithm>`, `<array>`  and `<type_traits>`
to greatly simplify the programming within a non-trivial
microcontroller situation.

This example is key because it combines the domains
of object-oriented programming with the templated
algorithms and wrappers of the STL to assist
in our microcontroller world.

### Libraries requiring more design considerations

Some C++ library and STL artifacts, however,
require more careful design considerations
regarding memory allocation and management.

Consider, for instance, `std::vector` from the `<vector>` library.
Vector creates a flexibly-sized array-like collection
of items of any kind, depending on the template parameter.

For instance:

```cpp
#include <vector>

// A vector of 3 integers.
std::vector<int> v { 1, 2, 3 };
```

See also the [main.cpp](./examples/vector/main.cpp) file
in the [./examples/vector](./examples/vector) directory.

This vector requires storage for three integers which,
on the `avr-gcc` platform is 6 bytes. The storage is managed
through vector's _second_, less well-known template parameter.
In other words,

```cpp
namespace std {

// Forward declaration of the vector template class.
template<typename T,
         typename AllocatorType = std::allocator<T>>
class vector;

}
```

Using containers requires memory allocation with a so-called allocator.
If none is specified, as in our code snippet, the default allocator
from namespace `std` for the templated type `T` of the vector is
automatically selected.

Good embeddable self-written custom allocators are essential for
using such containers so that memory could be managed with
a self-written memory pool, an off-chip memory device, etc.
A common selection is a pool of static memory creating a so-called
_ring_ _allocator_. This is an intermetiate/advanced topic
which will refine STL use _on_ _the_ _metal_ and
also allow for flexible template use in these resource-sensitive
realms.

## Notable adaptions and limitations

Some parts of the C++ standard library are not well suited for
tiny bare-metal systems. These include some memory-intensive
and/or hardware-intensive library artifacts.

`avr-libstdcpp` has the following known adaptions and limitations.

- **I/O streaming and RTTI:** I/O streaming and run-time type information (RTTI) are known
to be resource-intensive and could be disruptive on tiny
embedded platforms. An effort has been made to essentially
remove both these library dependencies and their
associated codes.

- **exceptions:** Exceptions are also difficult to efficiently
implement on tiny embedded platforms and this library port avoids using exceptions.
The headers `<stdexcept>` and `<exception>`, their dependencies,
and their directly relevant code sequences have been removed.
Simple mechanisms such as those found in `<cassert>`
and `<cerrno>`, however, remain mostly available.

- **`<atomic>`:** The `<atomic>` library is being handled
specifically in the draft of
[avr-libstdcpp/pull/36](https://github.com/modm-io/avr-libstdcpp/pull/36).

- **`<random>`:** There is no source of entropy whatsoever on these platforms
in their standard configuration. So `std::random_device`
has been removed.

- **Hashing:** Hashing has been optimized for tiny architectures and uses a rudimentary 16-bit CRC algorithm.

- **`<chrono>`:** Only certain judiciously selected clock functions from the `<chrono>` library are implemented.
These include `std::chrono::high_resolution_clock` and `std::chrono::steady_clock`. When using
these clocks, it is required to implement the clock's static method
`now()` in a project-specific fashion. This is because
the library's authors can not in a generic way implement any
microcontroller-specific clock(s) since this requires detailed knowledge
of the underlying microcontroller peripherie.

- **`int`, `size_t`, `ptrdiff_t` and the like:** Data types such as
`int`, and `size_t` and `ptrdiff_t` (which are aliased to
`unsigned`/`signed` versions of `int`)
are generally limited to 16-bits in width
on tiny `avr-gcc` platforms. Although this is a compiler attribute,
it has strong influence on the library (particularly the STL)
implementation because these data types are used copiously therein.
This compiler attribute limits ranges, indexes, etc. to 16-bits.
With the compiler switch `-mint8`, the built-in type `int`
is only 8 bits wide and extreme range limitations
are expected to make STL use tricky.

- **`<cmath>`:** In `avr-gcc` 10 and higher, the built-in data types
`double` and `long double` can be either 32 or 64 bits in width.
The widths depend on the compiler command line options `-mdouble=32`
(alternatively `-mdouble=64`) and/or `-mlong-double=32`
(alternatively `-mlong-double=64`). Standard floating-point
`<cmath>` functions such as `std::sin()`, `std::cos()`,
`std::exp()` and the like will, therefore, have input and output
widths according to these command line options.

## C++20 `constexpr` support

The following is a rather advanced, highly useful topic.
When using C++20, `constexpr` construction, assignment and evaluation
of various algorithms can and often will be generally
compile-time constant (i.e, via consistent use of C++20 `constexpr`-ness).

As a result of this, STL algorithms that use compile-time constant inputs are, in fact,
evaluated at compile time in C++20. This lets us perform a strong,
purposeful shift of algorithmic complexity _to_-_the_-_left_.
In other words, we shift algorithmic complexity _into_ the compile-time
stage of code development and _away from_ the precious RAM-ROM-space/cycles
of the compiled running code.

In the following code, for instance, we revisit the `std::array`/`<numeric>`
example from above. The variation below exhibits complete compile-time
evaluation of the algorithmic result.

To take the deep dive in this topic, follow all the useful compile-time
preprocessor symbols such as
`__cpp_lib_constexpr_algorithms`, `__cpp_lib_constexpr_numeric`, and many more
in [feature testing](https://en.cppreference.com/w/cpp/feature_test).

```cpp
#include <array>
#include <numeric>

#if (defined(__cpp_lib_constexpr_numeric) && (__cpp_lib_constexpr_numeric>=201911L))
#define MODM_CONSTEXPR constexpr
#define MODM_CONSTEXPR_NUMERIC_IS_CONSTEXPR 1
#else
#define MODM_CONSTEXPR
#define MODM_CONSTEXPR_NUMERIC_IS_CONSTEXPR 0
#endif

MODM_CONSTEXPR std::array<int, 3U> a { 1, 2, 3 };

int main()
{
  // 6
  auto MODM_CONSTEXPR sum = std::accumulate(a.cbegin(), a.cend(), 0);

  #if (MODM_CONSTEXPR_NUMERIC_IS_CONSTEXPR == 1)
  static_assert(sum == 6, "Error: Unexpected std::accumulate result!");
  #endif

  return (sum == 6 ? 0 : -1);
}
```

See also the [numeric.cpp](./examples/numeric/numeric.cpp) file
in the [/examples/numeric](./examples/numeric) directory.

## Additional details

`avr-libstdcpp` is intended for a modern `avr-gcc`
such as the port available in the [modm-io project](https://github.com/modm-io/avr-gcc)
repository. Tests show usability for `avr-gcc` 7 through 15.

This library has been checked for compatibility on `avr-gcc`
with language standards C++11,14,17,20,23 and 2c.

Using the port way back to `avr-gcc` 5 does not work
at the moment with today's form of the checked-in library,
and `avr-gcc` 7 or higher is required.
This is because the very old compiler lexical parsers are not capable
of properly handling some of the library's template code.
See also [avr-libstdcpp/issues/15](https://github.com/modm-io/avr-libstdcpp/issues/15)
which is closed and includes justification for its closure.

## Licensing

The library source files in [`src/`](./src/)
and the library include files in [`include/` and its subfolders](./include/)
(with two exceptions for the sources, as mentioned below)
are licensed under [GNU General Public License Version 3](./COPYING3) or higher.

All of the [example codes](./examples/) and also two library source files
(namely `functexcept.cc` and `math.cc` in [`src/`](./src/))
are subject to the terms of the [Mozilla Public License Version 2.0](./COPYING.MPLv2).
