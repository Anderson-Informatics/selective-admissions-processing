import ExcelJS from 'exceljs'
import { zipSync } from 'fflate'
import { AlignmentType, BorderStyle, Document, Header, HeightRule, PageOrientation, Packer, Paragraph, Table, TableCell, TableLayoutType, TableRow, TextRun, VerticalAlign, WidthType, type FileChild } from 'docx'
import { compareRosterNames, type IepRosterRow } from './iepRostering'

export const IEP_ROSTER_HEADERS = ['Submission ID', 'Student Name', 'Exam Date', 'Type', 'Complete Documents', 'Accommodations Required', 'Accommodation Group', 'Accommodations', 'Other Accommodations', 'Parent Phone Number']

export async function buildIepRosterWorkbook(rows: IepRosterRow[]) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('IEP Roster')
  sheet.addRow(IEP_ROSTER_HEADERS)
  for (const row of [...rows].sort((a, b) => a.examDate.localeCompare(b.examDate) || compareRosterNames(a, b))) {
    sheet.addRow([row.submissionIdInt ?? '', row.fullName, row.examDate, row.type, row.completeDocuments || 'Unknown', row.accommodationsRequired || 'Unknown', row.finalGroup, row.accommodations.replace(/;\s*/g, '\n'), row.otherAccommodations, row.parentPhone])
  }
  sheet.columns.forEach((column, i) => {
    column.width = [18, 30, 22, 12, 22, 26, 28, 48, 48, 26][i]
  })
  sheet.eachRow((row) => {
    row.alignment = { vertical: 'top', wrapText: true }
  })
  sheet.getColumn(10).numFmt = '@'
  sheet.getRow(1).font = { bold: true }
  sheet.getRow(1).height = 32
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  sheet.autoFilter = 'A1:J1'
  return Buffer.from(await workbook.xlsx.writeBuffer())
}

export async function buildIepRosterCards(input: IepRosterRow[]) {
  const rows = [...input].sort(compareRosterNames)
  const children: FileChild[] = []
  const paragraph = (value: string, notice = false) => new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 100 },
    children: [new TextRun({ text: value, font: 'Arial Nova Light', size: notice ? 28 : 44, bold: !notice, italics: notice, ...(notice ? { color: '0000FF' } : {}) })]
  })
  const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' }
  for (let start = 0; start < rows.length; start += 6) {
    if (start > 0) children.push(new Paragraph({ pageBreakBefore: true, spacing: { before: 0, after: 0 }, children: [] }))
    children.push(new Table({
      width: { size: 11520, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: [5760, 5760],
      borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
      rows: Array.from({ length: 3 }, (_, r) => new TableRow({
        cantSplit: true,
        height: { value: 4320, rule: HeightRule.ATLEAST },
        children: Array.from({ length: 2 }, (_, c) => {
          const student = rows[start + r * 2 + c]
          return new TableCell({
            width: { size: 5760, type: WidthType.DXA },
            verticalAlign: VerticalAlign.TOP,
            margins: { top: 120, bottom: 120, left: 160, right: 160 },
            children: student
              ? [paragraph(student.lastName && student.firstName ? `${student.lastName}, ${student.firstName}` : student.fullName || 'Name unavailable'), ...student.notices.map(notice => paragraph(notice, true))]
              : [new Paragraph('')]
          })
        })
      }))
    }))
  }
  const document = new Document({ sections: [{
    properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, bottom: 720, left: 360, right: 360 } } },
    children
  }] })
  return Packer.toBuffer(document)
}

export async function buildIepGroupedRoster(input: IepRosterRow[]) {
  const rows = [...input].sort((a, b) => a.finalGroup.localeCompare(b.finalGroup, undefined, { numeric: true }) || compareRosterNames(a, b))
  const widths = [1195, 2580, 1320, 2100, 3510, 2255]
  const headers = ['Sub ID', 'Student Name', 'Proctor', 'Accommodation Group', 'Accommodations', 'Other Accommodations']
  const cell = (value: string, index: number, heading = false, newGroup = false) => new TableCell({
    width: { size: widths[index]!, type: WidthType.DXA },
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 80, bottom: 80, left: 80, right: 80 },
    ...(heading ? { shading: { fill: 'E7E6E6' } } : {}),
    ...(newGroup ? { borders: { top: { style: BorderStyle.SINGLE, size: 12, color: '808080' } } } : {}),
    children: value.split(/;\s*|\r?\n/).map(text => new Paragraph({
      spacing: { after: 40 },
      children: [new TextRun({ text, bold: heading, font: 'Arial Nova Light', size: 20 })]
    }))
  })
  return Packer.toBuffer(new Document({ sections: [{
    properties: { page: { size: { width: 12240, height: 15840, orientation: PageOrientation.LANDSCAPE }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
    headers: { default: new Header({ children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: `HSPT Student Accommodations — ${rows[0]?.examDate || ''}`, font: 'Arial Nova Light', bold: true, size: 28 })]
    })] }) },
    children: [new Table({
      width: { size: 12960, type: WidthType.DXA },
      layout: TableLayoutType.FIXED,
      columnWidths: widths,
      rows: [
        new TableRow({ tableHeader: true, cantSplit: true, children: headers.map((text, index) => cell(text, index, true)) }),
        ...rows.map((row, rowIndex) => new TableRow({
          cantSplit: true,
          children: [String(row.submissionIdInt ?? ''), row.fullName, '', row.finalGroup, row.accommodations, row.otherAccommodations]
            .map((text, index) => cell(text, index, false, rowIndex > 0 && rows[rowIndex - 1]!.finalGroup !== row.finalGroup))
        }))
      ]
    })]
  }] }))
}

const safeName = (value: string) => value.replace(/[^\p{L}\p{N} ._-]/gu, '_').replace(/^\.+/, '').slice(0, 100).trim() || 'session'

export async function buildIepRosterExport(rows: IepRosterRow[], format: 'docx' | 'grouped-docx' | 'xlsx' | 'zip', allDays: boolean) {
  if (!rows.length) throw new Error('No roster students to export')
  const dayIds = [...new Set(rows.map(row => row.sessionLabelId))]
  if ((allDays && format !== 'zip') || (dayIds.length > 1 && format !== 'zip')) throw new Error('Multiple test days require ZIP format')
  const name = `iep-roster-${allDays ? 'all-days' : safeName(rows[0]!.examDate)}`
  if (format === 'xlsx') return { content: await buildIepRosterWorkbook(rows), filename: `${name}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
  if (format === 'docx' || format === 'grouped-docx') return {
    content: await (format === 'docx' ? buildIepRosterCards(rows) : buildIepGroupedRoster(rows)),
    filename: `${name}${format === 'grouped-docx' ? '-grouped' : ''}.docx`,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  }
  const files: Record<string, Uint8Array> = Object.create(null)
  files[`${name}.xlsx`] = await buildIepRosterWorkbook(rows)
  for (const [index, id] of dayIds.entries()) {
    const students = rows.filter(row => row.sessionLabelId === id)
    files[`${index + 1}-IEP_Roster_${safeName(students[0]!.examDate)}.docx`] = await buildIepRosterCards(students)
    files[`${index + 1}-IEP_Grouped_Roster_${safeName(students[0]!.examDate)}.docx`] = await buildIepGroupedRoster(students)
  }
  return { content: Buffer.from(zipSync(files)), filename: `${name}.zip`, contentType: 'application/zip' }
}
