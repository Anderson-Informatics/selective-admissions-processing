import { JobModel } from '../../../models/Job'
import { EditingReminderModel } from '../../../models/EditingReminder'
import { previewEditingReminders, reminderDigest, validateReminderInput } from '../../../utils/editingReminders'

export default defineEventHandler(async (event) => {
  const user = await requireAuth(event)
  await connectDb()
  const body = await readBody(event)
  let input
  try {
    input = validateReminderInput(body)
  } catch {
    throw createError({ statusCode: 400, statusMessage: 'A cycle, template, and 1–100 submission IDs are required' })
  }
  if (body.confirmed !== true || typeof body.digest !== 'string' || !/^[a-f\d]{64}$/.test(body.digest)
    || typeof body.requestKey !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(body.requestKey)) {
    throw createError({ statusCode: 400, statusMessage: 'A confirmed preview and request key are required' })
  }
  const executionKey = `editing-reminder:${reminderDigest({ actor: user.email, input, digest: body.digest, requestKey: body.requestKey })}`
  await Promise.all([JobModel.init(), EditingReminderModel.init()])
  let job = await JobModel.findOne({ executionKey })
  if (!job) {
    let preview
    try {
      preview = await previewEditingReminders(input)
    } catch {
      throw createError({ statusCode: 409, statusMessage: 'Selection or template changed. Refresh and preview again.' })
    }
    if (preview.digest !== body.digest) throw createError({ statusCode: 409, statusMessage: 'Personalized content changed. Preview again before confirming.' })
    try {
      job = await JobModel.findOneAndUpdate({ executionKey }, { $setOnInsert: {
        type: 'editing_reminder_send', status: 'waiting', cycleId: input.cycleId, createdBy: user.email,
        payload: { templateId: input.templateId, reminder: preview.snapshot },
        progress: { phase: 'queued', processed: 0, total: input.submissionIds.length, percent: 0, message: 'Preparing confirmed reminders' }
      } }, { upsert: true, returnDocument: 'after' })
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error
      job = await JobModel.findOne({ executionKey })
    }
  }
  if (!job?.payload.reminder) throw createError({ statusCode: 500, statusMessage: 'Unable to prepare reminder job' })
  await EditingReminderModel.bulkWrite(job.payload.reminder.recipients.map(recipient => ({ updateOne: {
    filter: { requestKey: executionKey, submissionId: recipient.submissionId },
    update: { $setOnInsert: { requestKey: executionKey, jobId: String(job._id), cycleId: job.cycleId, submissionId: recipient.submissionId, actor: job.createdBy, status: 'pending' } }, upsert: true
  } })))
  await JobModel.updateOne({ _id: job._id, status: 'waiting' }, { $set: { status: 'pending' } })
  return { jobId: String(job._id) }
})
