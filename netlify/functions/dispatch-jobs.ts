import { dispatchPendingJobs } from '../lib/dispatch'

export default async function handler(request: Request, context: any) {
  const secret = request.headers.get('x-job-dispatch-secret')
  if (!process.env.NUXT_JOB_DISPATCH_SECRET || secret !== process.env.NUXT_JOB_DISPATCH_SECRET) {
    return new Response('Unauthorized', { status: 401 })
  }

  const siteUrl = context?.site?.url || new URL(request.url).origin
  const jobIds = await dispatchPendingJobs(siteUrl)
  return Response.json({ dispatched: jobIds })
}
