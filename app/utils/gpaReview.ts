export interface GpaReview {
  stageName?: string
  status?: string
  mappedData?: Record<string, unknown>
  completedAt?: string
  createdAt?: string
}

export interface GpaReviewItem {
  _id: string
  submissionId: string
  submissionIdInt?: number
  submissionName?: string
  student?: string
  status?: string
  currentStageName?: string
  gpaStatus?: string
  resolvedCumulativeGpa?: number | null
  resolvedSource?: 'recording' | 'dpscd' | 'optIn' | 'partial' | null
  enrollmentConsidered?: string | number | null
  hasOptInLabel?: boolean
  reviewCompletion?: Array<{ name: string, status: string, required: boolean, complete: boolean }>
  gpa?: {
    dpscd?: {
      snapshots?: { r1?: { cumulativeGpa?: number, quartersAvailable?: number, gpaStatus?: string }, all?: { cumulativeGpa?: number, quartersAvailable?: number, gpaStatus?: string } }
      selectedSnapshot?: 'r1' | 'all'
      selectedRound?: string
      selectionIssue?: string
      studentNumber?: number
      studentName?: string
      dob?: string
      schoolNumber?: number
      schoolName?: string
      gradeLevel?: number
      minimumEntryDate?: string
      latestExitDate?: string
      quartersAvailable?: number
      cumulativeGpa?: number
      gpaStatus?: string
      importedAt?: string
    }
    optIn?: {
      studentName?: string
      enrolledMinTerms?: 'yes' | 'no' | ''
      termsEnrolled?: number
      cumulativeGpa?: number
      schoolName?: string
      sourceFile?: string
      importedAt?: string
    }
    gpaMultiplier?: number | null
    gpaBonusEligible?: boolean
    gpaBonus?: number | null
    gpaScore?: number | null
    updatedAt?: string
  } | null
  recordingReview?: GpaReview
  partialReview?: GpaReview
  updatedAtTimestamp?: string
}

export const gpaSourceLabels: Record<string, string> = {
  recording: 'GPA Recording',
  dpscd: 'DPSCD / PowerSchool',
  optIn: 'Opt-In',
  partial: 'Partial GPA'
}

export function sourceLabel(source?: string | null) {
  return source ? gpaSourceLabels[source] || source : '—'
}

export function formatOptInEnrollment(record: GpaReviewItem) {
  const optIn = record.gpa?.optIn
  if (!optIn) return '—'
  const terms = optIn.termsEnrolled != null ? ` (${optIn.termsEnrolled} term${optIn.termsEnrolled === 1 ? '' : 's'})` : ''
  if (optIn.enrolledMinTerms === 'yes') return `Yes${terms}`
  if (optIn.enrolledMinTerms === 'no') return `No${terms}`
  return terms ? `Unknown${terms}` : '—'
}

export function reviewIssues(record: GpaReviewItem) {
  const issues = [
    record.gpa?.dpscd?.selectionIssue,
    record.gpa?.optIn && !record.hasOptInLabel ? 'Missing Opt-In label' : '',
    record.gpa?.optIn && record.gpa.optIn.enrolledMinTerms !== 'yes' ? 'Opt-In enrollment not confirmed' : ''
  ]
  if (record.gpaStatus !== 'Complete' && !record.recordingReview && !record.partialReview) {
    issues.push('No completed GPA Recording or Partial GPA review')
  }
  return issues.filter(Boolean)
}

// Keys are full school names normalized to lowercase alphanumeric words.
// Short names follow the official list at https://www.detroitk12.org/schools.
const SCHOOL_NAME_SHORTHAND: Record<string, string> = {
  'a l holmes academy of blended learning': 'A.L. Holmes',
  'academy of the americas': 'Academy of the Americas',
  'bagley elementary school of journalism and technology': 'Bagley',
  'barton elementary school': 'Barton',
  'bates academy': 'Bates',
  'bennett elementary school': 'Bennett',
  'bow elementary middle school': 'Bow',
  'brenda scott academy': 'Brenda Scott',
  'brewer academy': 'Brewer',
  'bunche preparatory academy': 'Bunche',
  'burns elementary middle school': 'Burns',
  'burton international academy': 'Burton',
  'carleton elementary school': 'Carleton',
  'carstens academy of aquatic science at remus': 'Carstens (Remus)',
  'carver stem academy': 'Carver STEM',
  'charles wright academy of arts and science': 'Charles Wright',
  'charles wright academy of arts and sciences': 'Charles Wright',
  'chrysler elementary school': 'Chrysler',
  'clippert multicultural magnet honors academy': 'Clippert',
  'coleman a young elementary school': 'Coleman A. Young',
  'cooke stem academy': 'Cooke',
  'davison elementary middle school': 'Davison',
  'detroit international academy for young women': 'DIA',
  'detroit lions academy': 'Lions Academy',
  'dixon educational learning academy': 'Dixon',
  'dossin elementary middle school': 'Dossin',
  'durfee elementary middle school': 'Durfee',
  'earhart elementary middle school': 'Earhart',
  'edison elementary school': 'Edison',
  'edmonson elementary school': 'Edmonson',
  'edward duke ellington conservatory of music and art at beckham academy': 'Ellington (Beckham)',
  'edward duke ellington conservatory of music art at beckham academy': 'Ellington (Beckham)',
  'emerson elementary middle school': 'Emerson',
  'fisher magnet lower academy': 'Fisher Lower',
  'fisher magnet upper academy': 'Fisher Upper',
  'foreign language immersion and cultural studies': 'FLICS',
  'foreign language immersion and cultural studies school': 'FLICS',
  'gardner elementary school': 'Gardner',
  'garvey academy': 'Garvey',
  'golightly education center': 'Golightly',
  'gompers elementary middle school': 'Gompers',
  'hamilton elementary middle school': 'Hamilton',
  'harms elementary school': 'Harms',
  'henderson academy': 'Henderson',
  'hutchinson elementary middle school': 'Hutchinson',
  'hutchinson elementary middle school at howe': 'Hutchinson (Howe)',
  'john r king academic and performing arts academy': 'John R. King',
  'keidan special education center': 'Keidan',
  'mackenzie elementary middle school': 'Mackenzie',
  'mann learning community': 'Mann',
  'marion law academy': 'Law',
  'mark twain school for scholars': 'Mark Twain',
  'marquette elementary middle school': 'Marquette',
  'mary mcleod bethune elementary middle school': 'Bethune',
  'mason academy': 'Mason',
  'mason elementary middle school': 'Mason',
  'maybury elementary school': 'Maybury',
  'moses field center': 'Moses Field',
  'munger elementary middle school': 'Munger',
  'neinas dual language learning academy': 'Neinas',
  'nichols elementary middle school': 'Nichols',
  'noble elementary middle school': 'Noble',
  'nolan elementary middle school': 'Nolan',
  'palmer park preparatory academy': 'Palmer Park',
  'pasteur elementary school': 'Pasteur',
  'paul robeson malcolm x academy': 'PRMXA',
  'priest elementary middle school': 'Priest',
  'pulaski elementary middle school': 'Pulaski',
  'roberto clemente learning academy': 'Clemente',
  'ronald brown academy': 'Ronald Brown',
  'sampson webber leadership academy': 'Sampson-Webber',
  'schulze academy for technology and arts': 'Schulze',
  'schulze elementary middle school': 'Schulze',
  'spain elementary middle school': 'Spain',
  'the school at marygrove': 'Marygrove',
  'thirkell elementary middle school': 'Thirkell',
  'thurgood marshall elementary school': 'Thurgood Marshall',
  'turning point academy': 'Turning Point',
  'vernor elementary middle school': 'Vernor',
  'vernor elementary school': 'Vernor',
  'virtual school': 'Virtual',
  'wayne elementary school': 'Wayne',
  'cass technical high school': 'Cass Tech',
  'central academy and high school': 'Central',
  'cody high school': 'Cody',
  'communication and media arts high school': 'CMA',
  'crockett midtown high school of science and medicine': 'Crockett Midtown',
  'davis aerospace technical high school': 'Davis Aerospace',
  'denby high school': 'Denby',
  'detroit school of arts': 'DSA',
  'east english village preparatory academy at finney': 'East English Village',
  'frederick douglass academy for young men': 'Douglass',
  'frederick douglas academy for young men': 'Douglass',
  'henry ford high school': 'Henry Ford',
  'jerry l white center': 'Jerry L. White',
  'martin luther king jr senior high school': 'MLK',
  'martin luther king jr high school': 'MLK',
  'mumford high school': 'Mumford',
  'northwestern high school': 'Northwestern',
  'osborn high school': 'Osborn',
  'pershing high school': 'Pershing',
  'renaissance high school': 'Renaissance',
  'southeastern high school': 'Southeastern',
  'western international high school': 'Western'
}

const SCHOOL_WORD_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bhigh school\b/gi, 'HS'],
  [/\belementary(?: school)?\b/gi, ''],
  [/\bmiddle school\b/gi, 'MS'],
  [/\bmiddle\b/gi, ''],
  [/\bacademy\b/gi, ''],
  [/\bschool\b/gi, ''],
  [/\bof the\b|\bof\b|\bthe\b/gi, ''],
  [/\band\b/gi, '&'],
  [/\bpre-?k(?:indergarten)?\b/gi, 'PreK'],
  [/\bjunior\b/gi, 'Jr']
]

export function shortSchoolName(name?: string) {
  if (!name) return '—'
  const normalized = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const mapped = SCHOOL_NAME_SHORTHAND[normalized]
  if (mapped) return mapped
  const shortened = SCHOOL_WORD_ABBREVIATIONS
    .reduce((result, [pattern, replacement]) => result.replace(pattern, replacement), name.trim())
    .replace(/\s+/g, ' ')
    .replace(/^[&\s]+|[&\s]+$/g, '')
    .trim()
  return shortened || name.trim()
}

export function gpaStatusColor(status?: string) {
  if (status === 'Complete') return 'success' as const
  if (status === 'Incomplete') return 'error' as const
  return 'warning' as const
}
