import ExcelJS from 'exceljs'
import { unzipSync, strFromU8 } from 'fflate'
import { describe, expect, it } from 'vitest'
import { buildOptInSchoolExport, normalizeOptInSchool } from './optInExport'
import { parseOptInXlsx } from './gpa'

describe('Opt-In school exports', () => {
  it('removes parenthesized addresses and preserves a missing-school group', () => {
    expect(normalizeOptInSchool(' Academy (123 Main St) ')).toBe('Academy')
    expect(normalizeOptInSchool('')).toBe('Unknown School')
  })

  it('groups students into upload-compatible workbooks with Yes/No validation', async () => {
    const result = await buildOptInSchoolExport([
      { submissionIdInt: 101, mappedFields: { FirstName: 'Jamie', LastName: 'Rivera', DOB: '2012-04-03', OODSchool: 'Academy (123 Main)' } },
      { submissionIdInt: 102, mappedFields: { FirstName: 'Alex', LastName: 'Rivera', OODSchool: 'Academy (456 Other)' } },
      { submissionIdInt: 103, mappedFields: {} }
    ])
    expect(result.schools).toBe(2)
    expect(result.rows).toBe(3)
    const files = unzipSync(result.content)
    expect(Object.keys(files)).toEqual(['1-Academy.xlsx', '2-Unknown School.xlsx'])
    const content = Buffer.from(files['1-Academy.xlsx']!)
    const parsed = parseOptInXlsx('Academy.xlsx', content)
    expect(parsed.errors).toEqual([])
    expect(parsed.schoolName).toBe('Academy')
    expect(parsed.rows).toHaveLength(2)
    expect(parsed.rows[0]).toMatchObject({ submissionIdInt: 101, firstName: 'Jamie', lastName: 'Rivera', enrolledMinTerms: '' })
    expect(parsed.rows[0]?.cumulativeGpa).toBeUndefined()
    expect(parsed.rows[0]?.dob).toEqual(new Date(2012, 3, 3))
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(content as never)
    const sheet = workbook.worksheets[0]!
    expect(sheet.getCell('E4').value).toEqual(new Date('2012-04-03T00:00:00.000Z'))
    expect(sheet.getCell('E4').numFmt).toBe('mm/dd/yyyy')
    expect(sheet.getCell('E5').value).toBe('')
    for (const row of [4, 5]) {
      expect(sheet.getCell(`F${row}`).dataValidation).toMatchObject({
        type: 'list', formulae: ['"Yes,No"'], allowBlank: true, showErrorMessage: true, errorStyle: 'stop'
      })
    }
    const xml = strFromU8(unzipSync(content)['xl/worksheets/sheet1.xml']!)
    expect(xml).toContain('<dataValidations')
    sheet.getCell('F4').value = 'Yes'
    sheet.getCell('G4').value = 3
    sheet.getCell('H4').value = 3.75
    const filled = parseOptInXlsx('Academy.xlsx', Buffer.from(await workbook.xlsx.writeBuffer()))
    expect(filled.rows[0]).toMatchObject({ submissionIdInt: 101, enrolledMinTerms: 'yes', termsEnrolled: 3, cumulativeGpa: 3.75 })
  })

  it('keeps unsafe and colliding school filenames distinct', async () => {
    const result = await buildOptInSchoolExport(['../School/A', '.._School_A', '__proto__'].map((school, i) => ({ submissionIdInt: i + 1, mappedFields: { OODSchool: school } })))
    const names = Object.keys(unzipSync(result.content))
    expect(names).toHaveLength(3)
    expect(names.every(name => !name.includes('/'))).toBe(true)
  })

  it('rejects missing numeric IDs instead of silently omitting students', async () => {
    await expect(buildOptInSchoolExport([{ mappedFields: {} }])).rejects.toThrow('numeric SubmissionID')
  })
})
