import { useState } from 'react'

import { CloseIcon } from '../../../../assets/icons/interface/Close'
import { useOpenPLCStore } from '../../../../store'
import type { ProjectSearchEntry, ProjectSearchMatch } from '../../../../store/slices/search'
import { extractSearchQuery, highlightOccurrence } from '../../../../store/slices/search/utils'
import type { TabsProps } from '../../../../store/slices/tabs'
import { CreateEditorObjectFromTab } from '../../../../store/slices/tabs/utils'
import { Accordion } from '../../../_atoms/accordion'
import {
  ProjectSearchTreeBranch,
  ProjectSearchTreeRoot,
  ProjectSearchTreeVariableBranch,
  ProjectSearchTreeVariableLeaf,
} from './display/tree-view'

type BranchTarget = 'data-type' | 'function' | 'function-block' | 'program' | 'resource' | 'device'
type LeafLang = 'il' | 'st' | 'python' | 'cpp' | 'fbd' | 'sfc' | 'ld' | 'arr' | 'enum' | 'str' | 'res'

type MatchGroup = {
  key: string
  branch: BranchTarget
  label: string
  leafLang: LeafLang
  matches: ProjectSearchMatch[]
}

interface SearchProps {
  items: ProjectSearchEntry[]
}

const BRANCH_ORDER: BranchTarget[] = ['program', 'function', 'function-block', 'data-type', 'resource', 'device']

const dataTypeLeafLang = (derivation: 'array' | 'enumerated' | 'structure'): LeafLang => {
  switch (derivation) {
    case 'array':
      return 'arr'
    case 'enumerated':
      return 'enum'
    case 'structure':
      return 'str'
  }
}

const groupOf = (match: ProjectSearchMatch): MatchGroup => {
  const container = match.container
  switch (container.kind) {
    case 'pou':
      return {
        key: `pou:${container.pouType}:${container.name}`,
        branch: container.pouType,
        label: container.name,
        leafLang: container.language,
        matches: [],
      }
    case 'data-type':
      return {
        key: `data-type:${container.name}`,
        branch: 'data-type',
        label: container.name,
        leafLang: dataTypeLeafLang(container.derivation),
        matches: [],
      }
    case 'global-variable-list':
      return {
        key: `gvl:${container.name}`,
        branch: 'resource',
        label: container.name,
        leafLang: 'res',
        matches: [],
      }
    case 'resource': {
      const label =
        container.section === 'global-variable'
          ? 'Global Variables'
          : container.section === 'task'
            ? 'Tasks'
            : 'Instances'
      return { key: `resource:${container.section}`, branch: 'resource', label, leafLang: 'res', matches: [] }
    }
    case 'server':
      return { key: `server:${container.name}`, branch: 'device', label: container.name, leafLang: 'res', matches: [] }
    case 'remote-device':
      return { key: `device:${container.name}`, branch: 'device', label: container.name, leafLang: 'res', matches: [] }
  }
}

const groupMatches = (matches: ProjectSearchMatch[]): MatchGroup[] => {
  const groups = new Map<string, MatchGroup>()
  for (const match of matches) {
    const group = groupOf(match)
    const existing = groups.get(group.key)
    if (existing) {
      existing.matches.push(match)
      continue
    }
    group.matches.push(match)
    groups.set(group.key, group)
  }
  return [...groups.values()]
}

const rowLabel = (match: ProjectSearchMatch): string => {
  const highlighted = highlightOccurrence(match)
  if (match.field === 'body' && match.line !== undefined) return `Line ${match.line}: ${highlighted}`
  return highlighted
}

const Search = ({ items }: SearchProps) => {
  const {
    project: { data },
    searchActions: { removeSearchResult, setSearchQuery },
    tabsActions: { updateTabs },
    editorActions: { setEditor, addModel, getEditorFromEditors, setEditorCursor, setEditorGraphicalFocus },
  } = useOpenPLCStore()
  const [selectedMatchID, setSelectedMatchID] = useState<string | null>(null)

  const handleCreateTab = ({ elementType, name, path }: TabsProps) => {
    const tabToBeCreated = { name, path, elementType }
    updateTabs(tabToBeCreated)

    const editor = getEditorFromEditors(tabToBeCreated.name)
    if (!editor) {
      const model = CreateEditorObjectFromTab(tabToBeCreated)
      addModel(model)
      setEditor(model)
      return
    }
    addModel(editor)
    setEditor(editor)
  }

  const handleRemoveSearchResult = (itemID: string) => {
    removeSearchResult(itemID)
    setSearchQuery('')
  }

  const openPouMatch = (
    match: ProjectSearchMatch,
    container: Extract<ProjectSearchMatch['container'], { kind: 'pou' }>,
  ) => {
    handleCreateTab({
      name: container.name,
      path: `/data/pous/${container.pouType}/${container.name}`,
      elementType: { type: container.pouType, language: container.language },
    })

    if (match.line !== undefined) {
      setEditorCursor(container.name, {
        lineNumber: match.line,
        column: match.column ?? 1,
        offset: 0,
        target: 'body',
      })
      return
    }
    if (match.nodeId !== undefined) {
      setEditorGraphicalFocus(container.name, { nodeId: match.nodeId, rungId: match.rungId })
    }
  }

  const openMatch = (match: ProjectSearchMatch) => {
    setSelectedMatchID(match.id)
    const container = match.container

    switch (container.kind) {
      case 'pou':
        openPouMatch(match, container)
        return
      case 'data-type':
        handleCreateTab({
          name: container.name,
          path: `/data/data-types/${container.derivation}/${container.name}`,
          elementType: { type: 'data-type', derivation: container.derivation },
        })
        return
      case 'global-variable-list':
        handleCreateTab({
          name: container.name,
          path: `/data/global-variables/${container.name}`,
          elementType: { type: 'global-variable-list' },
        })
        return
      case 'resource':
        handleCreateTab({
          name: 'Resource',
          path: '/data/configuration/resource',
          elementType: { type: 'resource' },
        })
        return
      case 'server': {
        const server = (data.servers ?? []).find((candidate) => candidate.name === container.name)
        if (!server) return
        handleCreateTab({
          name: server.name,
          path: `/servers/${server.name}`,
          elementType: { type: 'server', protocol: server.protocol },
        })
        return
      }
      case 'remote-device': {
        const device = (data.remoteDevices ?? []).find((candidate) => candidate.name === container.name)
        if (!device) return
        handleCreateTab({
          name: device.name,
          path: `/devices/remote/${device.name}.json`,
          elementType: { type: 'remote-device', protocol: device.protocol },
        })
        return
      }
    }
  }

  return (
    <div className='h-full w-full text-cp-sm'>
      <div className='flex h-full w-full flex-col gap-1 rounded-lg border-[0.75px] border-neutral-200 p-2 dark:border-neutral-800 dark:bg-neutral-950'>
        <div className='header relative flex flex-col overflow-auto pr-1'>
          {items.length > 0 && (
            <Accordion
              items={items.map((item) => {
                const groups = groupMatches(item.matches)
                return {
                  searchID: item.searchID,
                  title: (
                    <div className='flex w-full items-center justify-between'>
                      <p className='text-sm font-medium text-neutral-950 dark:text-white'>
                        {item.searchQuery}
                        <span className='text-cp-sm font-normal text-neutral-950 dark:text-white'>
                          {' '}
                          - {item.searchCounts} matches
                        </span>
                      </p>
                      <CloseIcon
                        className='ml-2 w-4 cursor-pointer stroke-brand hover:stroke-red-500 dark:stroke-white'
                        onClick={() => handleRemoveSearchResult(item.searchID)}
                      />
                    </div>
                  ),
                  content: (
                    <ProjectSearchTreeRoot label={item.projectName}>
                      {BRANCH_ORDER.map((branch) => {
                        const branchGroups = groups.filter((group) => group.branch === branch)
                        if (branchGroups.length === 0) return null

                        return (
                          <ProjectSearchTreeBranch key={branch} branchTarget={branch}>
                            {branchGroups.map((group) => (
                              <ProjectSearchTreeVariableBranch
                                key={group.key}
                                label={extractSearchQuery(group.label, item.searchQuery)}
                                leafLang={group.leafLang}
                              >
                                {group.matches.map((match) => (
                                  <ProjectSearchTreeVariableLeaf
                                    key={`${group.key}:${match.id}`}
                                    label={rowLabel(match)}
                                    hasVariable={match.field !== 'body'}
                                    hasComment={match.field === 'body'}
                                    selected={selectedMatchID === match.id}
                                    onClick={() => openMatch(match)}
                                  />
                                ))}
                              </ProjectSearchTreeVariableBranch>
                            ))}
                          </ProjectSearchTreeBranch>
                        )
                      })}
                    </ProjectSearchTreeRoot>
                  ),
                }
              })}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export { Search }
