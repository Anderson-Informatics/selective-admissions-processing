import ExcelJS from 'exceljs'
import { zipSync } from 'fflate'
import type { Submission } from '../models/Submission'

export type OptInExportSubmission = Pick<Submission, 'submissionIdInt' | 'mappedFields'>

export function normalizeOptInSchool(value: unknown): string {
  return String(value ?? '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim() || 'Unknown School'
}

export async function buildOptInSchoolExport(submissions: OptInExportSubmission[]) {
  const schools = new Map<string, OptInExportSubmission[]>()
  for (const submission of submissions) {
    if (!Number.isSafeInteger(submission.submissionIdInt)) {
      throw new Error('An Opt-In submission is missing a valid numeric SubmissionID. Refresh submission data before exporting.')
    }
    const school = normalizeOptInSchool(submission.mappedFields.OODSchool)
    const rows = schools.get(school) ?? []
    rows.push(submission)
    schools.set(school, rows)
  }

  const files: Record<string, Uint8Array> = Object.create(null)
  for (const [index, [school, students]] of [...schools.entries()].sort(([a], [b]) => a.localeCompare(b)).entries()) {
    const workbook = new ExcelJS.Workbook()
    const sheet = workbook.addWorksheet('GPA')
    sheet.addRow([`School Name: ${school}`])
    sheet.addRow(['Complete the enrollment and GPA fields, then return this workbook for upload.'])
    sheet.addRow(['SubmissionID', 'Student Name', 'First Name', 'Last Name', 'Date of Birth', 'Enrolled for 3 semesters / 4 trimesters?', 'How many terms enrolled?', 'Cumulative GPA'])
    students.sort((a, b) => String(a.mappedFields.LastName ?? '').localeCompare(String(b.mappedFields.LastName ?? '')) || (a.submissionIdInt! - b.submissionIdInt!))
    for (const student of students) {
      const fields = student.mappedFields
      const first = String(fields.FirstName ?? '')
      const last = String(fields.LastName ?? '')
      const row = sheet.addRow([student.submissionIdInt, `${first} ${last}`.trim(), first, last, String(fields.DOB ?? ''), '', '', ''])
      row.getCell(6).dataValidation = {
        type: 'list', allowBlank: true, formulae: ['"Yes,No"'],
        showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Choose Yes or No',
        error: 'Select Yes or No from the dropdown.'
      }
    }
    sheet.getRow(3).font = { bold: true }
    sheet.getRow(3).alignment = { wrapText: true, vertical: 'middle' }
    sheet.getRow(3).height = 36
    sheet.columns.forEach((column, i) => {
      column.width = [18, 30, 22, 22, 20, 38, 26, 20][i]
    })
    sheet.views = [{ state: 'frozen', ySplit: 3 }]
    const safeName = school.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '').slice(0, 120).trim() || 'School'
    files[`${index + 1}-${safeName}.xlsx`] = new Uint8Array(await workbook.xlsx.writeBuffer())
  }
  return { content: Buffer.from(zipSync(files)), schools: schools.size, rows: submissions.length }
}
