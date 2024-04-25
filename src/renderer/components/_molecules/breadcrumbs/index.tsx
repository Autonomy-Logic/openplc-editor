import { NavigationPanelBreadcrumbs } from '@root/renderer/features/screens/workspace/components/panels/navigation-panel/breadcrumbs'

const Breadcrumbs = () => {
  return (
    <NavigationPanelBreadcrumbs
      crumb={{
        key: '1',
        project_name: 'Project Name',
        pou_to_display: {
          name: 'Pou Name',
          type: ['program'],
          language: ['ld'],
        },
      }}
    />
  )
}

export { Breadcrumbs }
