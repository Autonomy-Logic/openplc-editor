/** @jest-environment node */
import { loadHmiWidgetLibraries } from '../../lib/widget-libraries'
import { factorySymbol, previewFactoryDispatch, previewFactoryTable } from '../preview-factory'
import { installedWidgetArchives } from './fixtures/widget-libraries'

const catalog = () => loadHmiWidgetLibraries(installedWidgetArchives()).catalog

describe('preview factory tables', () => {
  it('number a table from 0 in name order, with setters shared by the block that declares them', () => {
    const widgets = [...catalog().widgets.values()]
    const table = previewFactoryTable(widgets, factorySymbol('standard-widgets'), 'lib.hpp', 'hmi')
    const names = Object.keys(table.types)
    expect(names).toEqual([...names].sort())
    expect(names.map((n) => table.types[n].type)).toEqual(names.map((_, i) => i))
    expect(table.types.HMILABEL.setters.PREFWIDTH).toEqual(table.types.HMIBUTTON.setters.PREFWIDTH)
    expect(table.source).toContain('void *hmi_factory_create__standard_widgets(int type)')
    expect(table.source).toContain('#include "lib.hpp"')
  })

  it('route each type to its table, numbering the tables one after another', () => {
    const all = catalog()
    const widgets = [...all.widgets.values()]
    const library = {
      ...previewFactoryTable(widgets.slice(0, 3), '__lib', 'lib.hpp', 'hmi'),
      library: 'standard-widgets',
    }
    const project = previewFactoryTable(widgets.slice(3, 5), '__project', 'unit.hpp', 'hmi')
    const { source, factory } = previewFactoryDispatch([library, project], all)
    const names = Object.keys(factory.types)
    expect(names.map((n) => factory.types[n].type)).toEqual([0, 1, 2, 3, 4])
    expect(source).toContain('if (type >= 0 && type < 3) return hmi_factory_create__lib(type - 0);')
    expect(source).toContain('if (type >= 3 && type < 5) return hmi_factory_create__project(type - 3);')
    expect(source).toContain('void hmi_factory_destroy__project(int type, void *element);')
  })

  it("takes a widget from the project's table when its library has no table for it", () => {
    const all = catalog()
    const widgets = [...all.widgets.values()]
    const project = previewFactoryTable(widgets.slice(0, 2), '__project', 'unit.hpp', 'hmi')
    const { factory } = previewFactoryDispatch([project], all)
    expect(Object.keys(factory.types)).toEqual(Object.keys(project.types))
  })

  it('compiles an empty dispatcher that creates nothing', () => {
    const { source, factory } = previewFactoryDispatch([], catalog())
    expect(factory.types).toEqual({})
    expect(source).toContain('return nullptr;')
  })
})
