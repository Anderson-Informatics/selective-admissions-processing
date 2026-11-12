import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  gpaUpdateMany: vi.fn(),
  applicationFind: vi.fn(),
  applicationUpdateOne: vi.fn()
}))

vi.mock('../models/GpaRecord', () => ({ GpaRecordModel: { updateMany: mocks.gpaUpdateMany } }))
vi.mock('../models/Application', () => ({ ApplicationModel: { find: mocks.applicationFind, updateOne: mocks.applicationUpdateOne } }))

const { migrateDpscdSchoolFields } = await import('./migrateDpscdSchoolFields')

describe('migrateDpscdSchoolFields', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.gpaUpdateMany.mockResolvedValue({ modifiedCount: 3 })
    mocks.applicationFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'app-1' }] }) })
  })

  it('copies legacy middle-school numbers to school numbers and removes the old field', async () => {
    await expect(migrateDpscdSchoolFields()).resolves.toEqual({ records: 3, applications: 0 })
    expect(mocks.gpaUpdateMany).toHaveBeenCalledWith(
      { 'dpscd.middleSchoolNumber': { $exists: true } },
      [
        { $set: { 'dpscd.schoolNumber': { $ifNull: ['$dpscd.schoolNumber', '$dpscd.middleSchoolNumber'] } } },
        { $unset: 'dpscd.middleSchoolNumber' }
      ],
      { updatePipeline: true }
    )
  })

  it('rewrites configured internal-form source fields', async () => {
    const scoring = { internalForm: { fields: { field1: { source: 'gpa', field: 'dpscd.middleSchoolNumber' }, field2: { source: 'gpa', field: 'dpscd.schoolNumber' } } }, note: 'middleSchoolNumber' }
    mocks.applicationFind.mockReturnValue({ select: () => ({ lean: async () => [{ _id: 'app-1', scoring }] }) })

    await expect(migrateDpscdSchoolFields()).resolves.toEqual({ records: 3, applications: 1 })
    expect(mocks.applicationUpdateOne).toHaveBeenCalledWith({ _id: 'app-1' }, { $set: {
      scoring: { internalForm: { fields: { field1: { source: 'gpa', field: 'dpscd.schoolNumber' }, field2: { source: 'gpa', field: 'dpscd.schoolNumber' } } }, note: 'middleSchoolNumber' }
    } })
  })
})
