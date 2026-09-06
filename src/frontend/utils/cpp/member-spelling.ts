// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
/**
 * How an IEC member name is spelled in the C++ a block actually compiles
 * against.
 *
 * A C++ block reaches its variables through `#define`s that strucpp's header
 * generator emits (`generateCBlocksCode`): the *top-level* name keeps the
 * casing the user authored, because the macro is defined under that spelling
 * (`#define motor (*(vars->MOTOR))`). Everything reached through a `.` from
 * there is a real C++ member of a strucpp-generated struct or class, and those
 * follow strucpp's rules — not the editor's.
 *
 * Two rules apply, and only the first is obvious:
 *
 *   1. **Upper-cased.** strucpp's parser normalises identifiers, so a STRUCT
 *      declared `speed : INT` emits `IEC_INT SPEED{}`.
 *
 *   2. **A trailing underscore on a collision.** A member whose name matches
 *      its own type's name is emitted with a `_` appended, because GCC rejects
 *      a member that changes the meaning of its type name within the class
 *      (`-Wchanges-meaning`). `Gear : Gear` becomes `GEAR_`, and — less
 *      obviously — so does `mode : Mode`. The same applies to a member whose
 *      name matches an interface method the owning function block implements.
 *
 * Rule 2 is imported from strucpp rather than restated here. It is the
 * compiler's rule, it has a second condition this module cannot evaluate (see
 * `interfaceMethods` below), and a private copy that fell behind would suggest
 * a member name that does not compile — the failure mode is a completion the
 * user accepts and then has to debug. `member-mangling.ts` exists in strucpp
 * precisely because the rule had been copied five times with three different
 * conditions; this is not the place to make that six.
 */

import { mangledMemberName } from 'strucpp/dist/backend/member-mangling.js'

/**
 * What the caller knows about the project's type names.
 *
 * `isUserDefinedType` decides whether a member's declared type is a project
 * type (structure, enumeration, function block) rather than an elementary one
 * — the precondition for the collision in rule 2.
 */
export interface CppMemberSpellingContext {
  isUserDefinedType: (typeName: string) => boolean
}

/**
 * The C++ spelling of one IEC member.
 *
 * `memberTypeName` is the member's declared IEC type, which is what strucpp's
 * LSP hands back on every completion item — so the caller never has to resolve
 * it. Pass `undefined` when the type is unknown; the collision cannot then be
 * detected and the name is returned upper-cased only, which is the same answer
 * for every member that isn't of a user-defined type.
 *
 * Note the interface-method half of rule 2 is deliberately not evaluated: the
 * editor has no INTERFACE / METHOD model, so `interfaceMethods` is left unset
 * and a member colliding with an implemented method is spelled without its
 * underscore. That case needs an ST project that declares an INTERFACE, which
 * the editor cannot currently author.
 */
export function cppMemberSpelling(
  memberName: string,
  memberTypeName: string | undefined,
  context: CppMemberSpellingContext,
): string {
  return mangledMemberName(memberName.toUpperCase(), memberTypeName, {
    isUserDefinedType: context.isUserDefinedType,
  })
}
