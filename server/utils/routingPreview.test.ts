import { describe, expect, it } from 'vitest'
import { applicantName, routingPreviewFilter } from './routingPreview'

describe('routing preview display and filtering', () => {
  it('uses FullName, then first and last name, then the submission ID', () => {
    expect(applicantName({ FullName: '  Jamie Rivera  ', FirstName: 'Jamie', LastName: 'Rivera' }, 'sub-1')).toBe('Jamie Rivera')
    expect(applicantName({ FullName: ' ', FirstName: ' Jamie ', LastName: ' Rivera ' }, 'sub-1')).toBe('Jamie Rivera')
    expect(applicantName({ FirstName: 'Jamie' }, 'sub-1')).toBe('Jamie')
    expect(applicantName({ FullName: null }, 'sub-1')).toBe('sub-1')
  })

  it('includes a selected label in the database filter before the submission limit', () => {
    expect(routingPreviewFilter('cycle-1')).toEqual({ cycleId: 'cycle-1' })
    expect(routingPreviewFilter('cycle-1', 'app-1', 'label-1')).toEqual({
      cycleId: 'cycle-1',
      applicationId: 'app-1',
      labelIds: 'label-1'
    })
  })
})
