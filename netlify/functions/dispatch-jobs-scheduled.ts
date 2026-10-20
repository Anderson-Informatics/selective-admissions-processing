import { dispatchPendingJobs } from '../lib/dispatch'

export const config = { schedule: '* * * * *' }

export default async function handler(_request: Request, context: { site?: { url?: string } }) {
  const siteUrl = context?.site?.url || process.env.URL
  if (!siteUrl) throw new Error('Netlify site URL is unavailable')
  await dispatchPendingJobs(siteUrl)
}
