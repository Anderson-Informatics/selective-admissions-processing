import type { NavigationMenuItem } from '@nuxt/ui'

interface NavigationGroup {
  label: string
  items: (NavigationMenuItem & { to: string })[]
}

export const navigationGroups: NavigationGroup[] = [
  {
    label: 'Overview',
    items: [{ label: 'Dashboard', to: '/', icon: 'i-lucide-house' }]
  },
  {
    label: 'Operations',
    items: [
      { label: 'Submissions', to: '/submissions', icon: 'i-lucide-inbox' },
      { label: 'Data Validation', to: '/validation', icon: 'i-lucide-shield-check' },
      { label: 'Jobs', to: '/jobs', icon: 'i-lucide-list-checks' }
    ]
  },
  {
    label: 'Assessment',
    items: [
      { label: 'Essays', to: '/essays', icon: 'i-lucide-file-pen-line' },
      { label: 'HSPT', to: '/hspt', icon: 'i-lucide-graduation-cap' },
      { label: 'GPA', to: '/gpa', icon: 'i-lucide-chart-column' }
    ]
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Cycles', to: '/cycles', icon: 'i-lucide-calendar-days' },
      { label: 'Applications', to: '/applications', icon: 'i-lucide-files' },
      { label: 'Mappings', to: '/mappings', icon: 'i-lucide-map' },
      { label: 'Templates', to: '/templates', icon: 'i-lucide-file-text' },
      { label: 'Response Libraries', to: '/response-libraries', icon: 'i-lucide-list-tree' },
      { label: 'Routing', to: '/routing', icon: 'i-lucide-git-branch' }
    ]
  }
]

export function isNavigationActive(fullPath: string, destination: string): boolean {
  const path = fullPath.split(/[?#]/)[0] || '/'
  return path === destination || (destination !== '/' && path.startsWith(`${destination}/`))
}
