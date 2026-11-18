import { describe, expect, it, vi } from 'vitest'
import { deriveGpaBonusEligible } from './gpaScoring'

vi.mock('../models/Metadata', () => ({ MetadataModel: { findOne: vi.fn() } }))

const review = (stageName: string, mappedData: Record<string, unknown> = {}, status = 'completed') => ({
  stageId: stageName, stageName, status, completedAt: new Date('2026-10-01'), mappedData
})

describe('deriveGpaBonusEligible', () => {
  it('grants the bonus when a GPA Completion review satisfies requirements', () => {
    expect(deriveGpaBonusEligible({
      reviews: [review('GPA Completion', { RequirementsSatisfied: 'Yes' })]
    })).toBe(true)
  })

  it('grants the bonus for the External GPA stage', () => {
    expect(deriveGpaBonusEligible({
      reviews: [review('External GPA - DPSCD and Opt-In Schools', { RequirementsSatisfied: 'Yes' })]
    })).toBe(true)
  })

  it('does not grant the bonus for the Incomplete GPA stage', () => {
    expect(deriveGpaBonusEligible({
      reviews: [review('Incomplete GPA', { RequirementsSatisfied: 'Yes' })]
    })).toBe(false)
  })

  it('ignores RequirementsSatisfied = No and incomplete reviews', () => {
    expect(deriveGpaBonusEligible({
      reviews: [
        review('GPA Completion', { RequirementsSatisfied: 'No' }),
        review('GPA Completion', { RequirementsSatisfied: 'Yes' }, 'in_progress')
      ]
    })).toBe(false)
  })

  it('honors configured stage names instead of the defaults', () => {
    const input = { reviews: [review('Custom GPA Review', { RequirementsSatisfied: 'Yes' })] }
    expect(deriveGpaBonusEligible(input)).toBe(false)
    expect(deriveGpaBonusEligible({ ...input, stageNames: ['Custom GPA Review'] })).toBe(true)
    expect(deriveGpaBonusEligible({ reviews: [review('GPA Completion', { RequirementsSatisfied: 'Yes' })], stageNames: ['Custom GPA Review'] })).toBe(false)
  })

  it('grants the bonus for a complete DPSCD record even when another source resolves', () => {
    expect(deriveGpaBonusEligible({
      reviews: [review('GPA Recording', { AbleToRecord: 'Yes', CumulativeGPA: 4 })],
      gpa: { dpscd: { cumulativeGpa: 3.6, quartersAvailable: 8 } }
    })).toBe(true)
  })

  it('rejects DPSCD records below six quarters or without a valid GPA', () => {
    expect(deriveGpaBonusEligible({
      reviews: [],
      gpa: { dpscd: { cumulativeGpa: 3.6, quartersAvailable: 5 } }
    })).toBe(false)
    expect(deriveGpaBonusEligible({
      reviews: [],
      gpa: { dpscd: { quartersAvailable: 9 } }
    })).toBe(false)
  })

  it('requires an explicit yes for Opt-In enrollment terms', () => {
    expect(deriveGpaBonusEligible({
      reviews: [],
      gpa: { optIn: { cumulativeGpa: 3.8, enrolledMinTerms: 'yes' } }
    })).toBe(true)
    expect(deriveGpaBonusEligible({
      reviews: [],
      gpa: { optIn: { cumulativeGpa: 3.8, enrolledMinTerms: '' } }
    })).toBe(false)
    expect(deriveGpaBonusEligible({
      reviews: [],
      gpa: { optIn: { cumulativeGpa: 3.8, enrolledMinTerms: 'no' } }
    })).toBe(false)
  })

  it('uses the latest completed bonus review', () => {
    const input = {
      reviews: [
        { stageId: 'x', stageName: 'GPA Completion', status: 'completed', completedAt: new Date('2026-11-01'), mappedData: { RequirementsSatisfied: 'No' } },
        { stageId: 'x', stageName: 'GPA Completion', status: 'completed', completedAt: new Date('2026-10-01'), mappedData: { RequirementsSatisfied: 'Yes' } }
      ]
    }
    expect(deriveGpaBonusEligible(input)).toBe(false)
  })
})
