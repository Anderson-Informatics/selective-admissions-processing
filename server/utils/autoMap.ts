import { LEGACY_FIELD_MAP } from './legacyFieldMap'

interface FieldPattern {
  canonical: string
  keywords: string[]
  exclude?: string[]
}

const FIELD_PATTERNS: FieldPattern[] = [
  { canonical: 'ParentFirstName', keywords: ['parent', 'first', 'name'] },
  { canonical: 'ParentLastName', keywords: ['parent', 'last', 'name'] },
  { canonical: 'GuardianFirstName', keywords: ['guardian', 'first', 'name'] },
  { canonical: 'GuardianLastName', keywords: ['guardian', 'last', 'name'] },
  { canonical: 'ParentEmail', keywords: ['parent', 'email'] },
  { canonical: 'GuardianEmail', keywords: ['guardian', 'email'] },
  { canonical: 'ParentPhone', keywords: ['parent', 'phone'] },
  { canonical: 'GuardianPhone', keywords: ['guardian', 'phone'] },
  { canonical: 'FirstName', keywords: ['first', 'name'] },
  { canonical: 'LastName', keywords: ['last', 'name'] },
  { canonical: 'FullName', keywords: ['full', 'name'] },
  { canonical: 'FullName', keywords: ['name'], exclude: ['parent', 'guardian', 'first', 'last', 'full'] },
  { canonical: 'Email', keywords: ['email'] },
  { canonical: 'Phone', keywords: ['phone'] },
  { canonical: 'Mobile', keywords: ['mobile'] },
  { canonical: 'Cell', keywords: ['cell'] },
  { canonical: 'DOB', keywords: ['birth', 'date'] },
  { canonical: 'DOB', keywords: ['dob'] },
  { canonical: 'Address1', keywords: ['address', '1'] },
  { canonical: 'Address2', keywords: ['address', '2'] },
  { canonical: 'StreetAddress', keywords: ['street', 'address'] },
  { canonical: 'City', keywords: ['city'] },
  { canonical: 'State', keywords: ['state'] },
  { canonical: 'Zip', keywords: ['zip', 'postal'] },
  { canonical: 'Country', keywords: ['country'] },
  { canonical: 'StudentId', keywords: ['student', 'id'] },
  { canonical: 'SchoolPreference', keywords: ['preference', 'school'] },
  { canonical: 'SchoolApplying', keywords: ['apply', 'school'] },
  { canonical: 'CurrentSchool', keywords: ['current', 'school'] },
  { canonical: 'Siblings', keywords: ['sibling'] }
]

export function guessCanonicalName(extractKey?: string, label?: string): string | undefined {
  if (extractKey && LEGACY_FIELD_MAP[extractKey]) {
    return LEGACY_FIELD_MAP[extractKey]
  }

  return fallbackGuess(label || extractKey)
}

function fallbackGuess(label?: string): string | undefined {
  if (!label) return undefined

  const words = new Set(
    label
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
  )

  if (words.size === 0) return undefined

  for (const pattern of FIELD_PATTERNS) {
    const keywordsMatch = pattern.keywords.every(keyword => words.has(keyword))
    const excluded = pattern.exclude?.some(keyword => words.has(keyword)) ?? false
    if (keywordsMatch && !excluded) {
      return pattern.canonical
    }
  }

  return undefined
}
