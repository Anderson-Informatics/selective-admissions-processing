import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { strFromU8, unzipSync } from 'fflate'
import { buildIepRosterCards, buildIepRosterExport, buildIepRosterWorkbook, IEP_ROSTER_HEADERS } from './iepRosterExport'
import type { IepRosterRow } from './iepRostering'

const students = (count: number): IepRosterRow[] => Array.from({ length: count }, (_, i) => ({
  submissionId: `s${i}`, submissionIdInt: 100 + i, sessionLabelId: 'day', examDate: 'HSPT Nov 21', firstName: 'First', lastName: `Last${String(i).padStart(2, '0')}`, fullName: `First Last${i}`,
  type: 'IEP', completeDocuments: 'Yes', accommodationsRequired: 'Yes', accommodations: 'Extended time; Spanish Support', otherAccommodations: '=not a formula', parentPhone: '0123456789', language: 'Spanish', mllSupport: true,
  accommodationGroup: 'Group F - spanish', finalGroup: 'Group F1 - spanish', notices: ['MLL Language: Spanish'], warnings: []
}))

describe('roster documents', () => {
  it.each([1, 6, 7, 13])('renders %i cards as six-cell pages without a trailing page break', async (count) => {
    const input = students(count).reverse()
    input[0]!.firstName = 'A & B <C>'
    const files = unzipSync(await buildIepRosterCards(input))
    const xml = strFromU8(files['word/document.xml']!)
    const pages = Math.ceil(count / 6)
    expect(xml.match(/<w:tbl>/g)).toHaveLength(pages)
    expect(xml.match(/<w:tc>/g)).toHaveLength(pages * 6)
    expect(xml.match(/<w:pageBreakBefore\/>/g) || []).toHaveLength(pages - 1)
    expect(xml).toContain('A &amp; B &lt;C&gt;')
    expect(xml).toContain('w:w="12240" w:h="15840"')
    expect(xml).toContain('w:color w:val="0000FF"')
    expect(xml).toContain('w:sz w:val="44"')
    expect(xml).toContain('MLL Language: Spanish')
    expect(xml).not.toContain('Group F1')
    expect(xml).not.toContain('Extended time')
    if (count > 1) expect(xml.indexOf('Last00')).toBeLessThan(xml.indexOf(`Last${String(count - 1).padStart(2, '0')}`))
  })

  it('writes the legacy columns, typed IDs/phones and literal cell values', async () => {
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(await buildIepRosterWorkbook(students(2)) as never)
    const sheet = workbook.worksheets[0]!
    expect((sheet.getRow(1).values as string[]).slice(1)).toEqual(IEP_ROSTER_HEADERS)
    expect(sheet.getCell('A2').value).toBe(100)
    expect(sheet.getCell('J2').value).toBe('0123456789')
    expect(sheet.getCell('I2').value).toBe('=not a formula')
    expect(sheet.getCell('H2').value).toBe('Extended time\nSpanish Support')
    expect(sheet.getCell('G2').value).toBe('Group F1 - spanish')
    expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 })
  })

  it('packages one Word file per day and a combined workbook with safe names', async () => {
    const rows = students(2)
    rows[1]!.sessionLabelId = 'day2'
    rows[1]!.examDate = '../HSPT / Nov:21'
    const output = await buildIepRosterExport(rows, 'zip', true)
    const files = unzipSync(output.content)
    expect(Object.keys(files)).toHaveLength(3)
    expect(Object.keys(files).filter(name => name.endsWith('.docx'))).toHaveLength(2)
    expect(Object.keys(files).some(name => name.includes('/'))).toBe(false)
    const workbook = new ExcelJS.Workbook()
    await workbook.xlsx.load(Buffer.from(files['iep-roster-all-days.xlsx']!) as never)
    expect(workbook.worksheets[0]!.rowCount).toBe(3)
    await expect(buildIepRosterExport(rows, 'docx', true)).rejects.toThrow('Multiple test days')
    await expect(buildIepRosterExport([], 'zip', true)).rejects.toThrow('No roster students')
  })
})
