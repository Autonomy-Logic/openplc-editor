import { describe, expect, it } from '@jest/globals'

import { cppMemberSpelling } from '../member-spelling'

/**
 * The project types in play. `isUserDefinedType` is the precondition for
 * strucpp's collision rule — an elementary type can never collide, because no
 * member is declared with a type whose name it also carries.
 */
const isUserDefinedType = (name: string) => ['MOTOR', 'GEAR', 'MODE', 'IRRIGATION_STATE'].includes(name.toUpperCase())

describe('cppMemberSpelling', () => {
  it('upper-cases the IEC name', () => {
    expect(cppMemberSpelling('speed', 'INT', { isUserDefinedType })).toBe('SPEED')
    expect(cppMemberSpelling('set_point', 'REAL', { isUserDefinedType })).toBe('SET_POINT')
    expect(cppMemberSpelling('isRunning', 'BOOL', { isUserDefinedType })).toBe('ISRUNNING')
  })

  // Verified against real strucpp output: compiling
  //   Motor : STRUCT speed : INT; Gear : Gear; mode : Mode; END_STRUCT
  // emits `IEC_INT SPEED{}; GEAR GEAR_{}; IEC_MODE MODE_{};`
  it('appends the underscore when a member is named after its own type', () => {
    expect(cppMemberSpelling('Gear', 'Gear', { isUserDefinedType })).toBe('GEAR_')
  })

  it('appends the underscore for an enum-typed member too', () => {
    // The non-obvious one: `mode : Mode` collides just as `Gear : Gear` does,
    // and a hand-rolled toUpperCase() would silently suggest `MODE`.
    expect(cppMemberSpelling('mode', 'Mode', { isUserDefinedType })).toBe('MODE_')
  })

  it('does not append the underscore when the names merely resemble each other', () => {
    expect(cppMemberSpelling('gearbox', 'Gear', { isUserDefinedType })).toBe('GEARBOX')
    expect(cppMemberSpelling('gear_ratio', 'Gear', { isUserDefinedType })).toBe('GEAR_RATIO')
  })

  it('does not append the underscore for an elementary type of the same name', () => {
    // A member can be called `int`; `INT` is not a user-defined type, so no
    // collision with the class name arises.
    expect(cppMemberSpelling('int', 'INT', { isUserDefinedType })).toBe('INT')
  })

  it('upper-cases only when the member type is unknown', () => {
    // strucpp supplies no type for some items; the collision is then
    // undetectable, and upper-casing is the answer for every non-UDT member.
    expect(cppMemberSpelling('speed', undefined, { isUserDefinedType })).toBe('SPEED')
  })

  it('is case-insensitive about the collision', () => {
    expect(cppMemberSpelling('GEAR', 'gear', { isUserDefinedType })).toBe('GEAR_')
    expect(cppMemberSpelling('gEaR', 'GeAr', { isUserDefinedType })).toBe('GEAR_')
  })
})
