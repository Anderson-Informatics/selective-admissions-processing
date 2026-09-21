import { leasePendingChildJobs } from '../utils/jobDispatcher'
import { processQueuedJob } from '../utils/jobWorker'

const workerKey = '__ehsJobWorkerRunning'

export default defineNitroPlugin(() => {
  const gt = globalThis as Record<string, unknown>
  if (!import.meta.dev || gt[workerKey]) return
  gt[workerKey] = true

  const run = async () => {
    try {
      await connectDb()
      const config = useRuntimeConfig()
      const concurrency = Math.max(1, Number(config.jobConcurrency || 3))
      const jobs = await leasePendingChildJobs(concurrency, 16, Number(config.jobMaxAttempts || 3))
      for (const job of jobs) {
        void processQueuedJob(String(job._id), {
          mongodbUri: config.mongodbUri,
          submittable: {
            apiKey: config.submittableApiKey,
            baseUrl: config.submittableBaseUrl,
            v3BaseUrl: config.submittableV3BaseUrl
          },
          hereApiKey: config.hereApiKey,
          maxAttempts: Number(config.jobMaxAttempts || 3)
        }).catch(error => console.error(`Local job ${job._id} failed`, error))
      }
    } catch (error) {
      console.error('Local job worker failed', error)
    } finally {
      setTimeout(run, 2000)
    }
  }

  setTimeout(run, 500)
})
