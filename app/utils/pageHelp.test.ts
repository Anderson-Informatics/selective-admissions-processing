import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { pageHelp } from './pageHelp'

describe('page help', () => {
  it('provides complete guidance for every page and uses every help entry', () => {
    const pagesDirectory = fileURLToPath(new URL('../pages/', import.meta.url))
    const pages = readdirSync(pagesDirectory, { recursive: true })
      .filter((path): path is string => typeof path === 'string' && path.endsWith('.vue'))
    const usedKeys: string[] = []

    for (const page of pages) {
      const source = readFileSync(`${pagesDirectory}/${page}`, 'utf8')
      const headers = [...source.matchAll(/<PageHeader\b[^>]*\bhelp="([^"]+)"/g)]
      expect(headers, `${page} must have exactly one help-enabled header`).toHaveLength(1)
      const key = headers[0]![1]!
      expect(Object.keys(pageHelp), `${page} must reference existing help`).toContain(key)
      usedKeys.push(key)
    }

    expect(usedKeys.sort()).toEqual(Object.keys(pageHelp).sort())
    for (const content of Object.values(pageHelp)) {
      expect(content.title.length).toBeGreaterThan(0)
      expect(content.purpose.length).toBeGreaterThan(40)
      expect(content.tasks.length).toBeGreaterThanOrEqual(3)
      expect(content.gettingStarted.length).toBeGreaterThan(40)
      expect(content.important.length).toBeGreaterThanOrEqual(2)
    }
  })

  it('distinguishes preview, draft, publishing, and actions with real effects', () => {
    expect(pageHelp.routing.important.join(' ')).toContain('at most 500')
    expect(pageHelp.routing.important.join(' ')).toContain('Live routing can write to Submittable')
    expect(pageHelp.applicationDetail.important.join(' ')).toContain('does not itself execute routing')
    expect(pageHelp.templates.important.join(' ')).toContain('Send test message does send an email')
    expect(pageHelp.essays.tasks.join(' ')).toContain('without moving submissions')
  })
})
