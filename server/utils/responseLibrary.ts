export function slugifyLibraryKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function sanitizeLibraryEntries(input: unknown): { match: string, text: string }[] {
  if (!Array.isArray(input)) return []
  return input
    .map(entry => ({
      match: typeof entry?.match === 'string' ? entry.match.trim() : '',
      text: typeof entry?.text === 'string' ? entry.text : ''
    }))
    .filter(entry => entry.match)
}
