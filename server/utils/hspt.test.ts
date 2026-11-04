import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CycleModel } from '../models/Cycle'
import { HSPTResultModel } from '../models/HSPTResult'
import { parseAndUpsertHSPTCsv, previewHSPTCsv } from './hspt'

const csv = 'HPID,Last,First,Birth,TestCenter,batch,OptCd,RDRS,MTRS,LNRS,OPRS\n101,Rivera,Jamie,02/29/2012,Center A,Fall,12345,62,64,60,40'

beforeEach(() => {
  vi.restoreAllMocks()
  vi.spyOn(CycleModel, 'findOneAndUpdate').mockResolvedValue({ hsptResultIdCounter: 1001 } as never)
  vi.spyOn(HSPTResultModel, 'bulkWrite').mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 } as never)
})

describe('HSPT CSV ingestion', () => {
  it('previews missing identifiers without writing records', () => {
    expect(previewHSPTCsv('scores.csv', `${csv}\n102,,Alex,01/01/2012,A,Fall,,1,2,3,4`)).toMatchObject({ processed: 2, valid: 1, invalid: 1 })
    expect(HSPTResultModel.bulkWrite).not.toHaveBeenCalled()
    expect(CycleModel.findOneAndUpdate).not.toHaveBeenCalled()
  })

  it('computes historical scaled scores and scopes upserts to the cycle', async () => {
    await expect(parseAndUpsertHSPTCsv('cycle-1', 'scores.csv', csv)).resolves.toMatchObject({ processed: 1, inserted: 1, errors: [] })
    expect(HSPTResultModel.bulkWrite).toHaveBeenCalledWith([
      { updateOne: {
        filter: { cycleId: 'cycle-1', sourceId: '101|center a|fall|rivera|jamie|02/29/2012' },
        update: {
          $setOnInsert: expect.objectContaining({ cycleId: 'cycle-1', resultId: 1001 }),
          $set: expect.objectContaining({ reading: 11.25, math: 15, language: 11.25, science: 7.5, overall: 45, birthDate: new Date('2012-02-29T00:00:00Z') })
        },
        upsert: true
      } }
    ])
  })

  it('uses the same upsert key on reimport without overwriting existing links or match status', async () => {
    await parseAndUpsertHSPTCsv('cycle-1', 'scores.csv', csv)
    await parseAndUpsertHSPTCsv('cycle-1', 'corrected.csv', csv.replace(',62,64,60,40', ',31,32,30,20'))
    const calls = vi.mocked(HSPTResultModel.bulkWrite).mock.calls
    expect(calls[1]![0][0]).toMatchObject({ updateOne: { filter: (calls[0]![0][0] as { updateOne: { filter: unknown } }).updateOne.filter } })
    const operation = calls[1]![0][0] as { updateOne: { update: { $set: Record<string, unknown>, $setOnInsert: Record<string, unknown> } } }
    expect(operation.updateOne.update.$set.overall).toBe(22.5)
    for (const field of ['linkedSubmissionId', 'matchType', 'matchScore', 'status']) {
      expect(operation.updateOne.update.$set).not.toHaveProperty(field)
      expect(operation.updateOne.update.$setOnInsert).not.toHaveProperty(field)
    }
  })

  it('does not write empty files or rows missing key fields', async () => {
    await expect(parseAndUpsertHSPTCsv('cycle-1', 'empty.csv', csv.split('\n')[0]!)).resolves.toMatchObject({ processed: 0 })
    expect(CycleModel.findOneAndUpdate).not.toHaveBeenCalled()
    await expect(parseAndUpsertHSPTCsv('cycle-1', 'invalid.csv', csv.replace('101,Rivera,Jamie', '101,,Jamie'))).resolves.toMatchObject({ inserted: 0, errors: ['Missing key fields in row 1'] })
    expect(HSPTResultModel.bulkWrite).not.toHaveBeenCalled()
  })

  it('propagates database failures instead of reporting a successful import', async () => {
    vi.mocked(HSPTResultModel.bulkWrite).mockRejectedValueOnce(new Error('write failed'))
    await expect(parseAndUpsertHSPTCsv('cycle-1', 'scores.csv', csv)).rejects.toThrow('write failed')
  })
})
