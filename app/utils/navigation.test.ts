import { describe, expect, it } from 'vitest'
import { isNavigationActive, navigationGroups } from './navigation'

describe('application navigation', () => {
  it('lists every primary destination exactly once in task order', () => {
    expect(navigationGroups.map(group => group.label)).toEqual(['Overview', 'Operations', 'Assessment', 'Configuration'])
    const destinations = navigationGroups.flatMap(group => group.items.map(item => item.to))
    expect(destinations).toEqual([
      '/', '/submissions', '/validation', '/jobs', '/essays', '/hspt', '/gpa',
      '/cycles', '/applications', '/mappings', '/templates', '/response-libraries', '/routing'
    ])
    expect(new Set(destinations).size).toBe(13)
  })

  it('makes Data Validation a permanent Operations destination', () => {
    expect(navigationGroups.find(group => group.label === 'Operations')?.items)
      .toContainEqual({ label: 'Data Validation', to: '/validation', icon: 'i-lucide-shield-check' })
  })

  it('only highlights Dashboard at the root', () => {
    expect(isNavigationActive('/', '/')).toBe(true)
    expect(isNavigationActive('/?cycle=active', '/')).toBe(true)
    expect(isNavigationActive('/cycles', '/')).toBe(false)
  })

  it('highlights parents on nested routes and ignores query strings and fragments', () => {
    for (const path of ['/cycles', '/cycles/', '/cycles/new', '/cycles/123?tab=rounds', '/cycles#active']) {
      expect(isNavigationActive(path, '/cycles')).toBe(true)
    }
    expect(isNavigationActive('/applications/123', '/applications')).toBe(true)
    expect(isNavigationActive('/validation?severity=error', '/validation')).toBe(true)
  })

  it('rejects unrelated path prefixes', () => {
    expect(isNavigationActive('/cycles-archive', '/cycles')).toBe(false)
    expect(isNavigationActive('/applications-extra/123', '/applications')).toBe(false)
    expect(isNavigationActive('/jobs', '/validation')).toBe(false)
  })
})
