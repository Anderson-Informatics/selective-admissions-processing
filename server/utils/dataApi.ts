import { createHmac, timingSafeEqual } from 'node:crypto'
import type { H3Event } from 'h3'

export const notWithdrawnFilter = () => ({ status: { $not: /^withdrawn$/i } })

export function requireDataKey(event: H3Event) {
  const { dataKey, dataSecret } = useRuntimeConfig()
  if (!dataKey || !dataSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Service Unavailable' })
  }

  const authorization = getHeader(event, 'authorization')
  const suppliedKey = /^Bearer ([^\s]+)$/i.exec(authorization || '')?.[1]
  const digest = (key: string) => createHmac('sha256', dataSecret).update(key).digest()
  if (!suppliedKey || !timingSafeEqual(digest(suppliedKey), digest(dataKey))) {
    throw createError({ statusCode: 401, statusMessage: 'Unauthorized' })
  }
}

export function parseDataFormat(query: Record<string, unknown>) {
  const format = query.format ?? 'json'
  if (format !== 'json' && format !== 'csv') {
    throw createError({ statusCode: 400, statusMessage: 'format must be json or csv' })
  }
  return format
}

export function parseDataPagination(query: Record<string, unknown>) {
  const page = Number(query.page ?? 1)
  const limit = Number(query.limit ?? 100)
  if (Array.isArray(query.page) || Array.isArray(query.limit)
    || !Number.isSafeInteger(page) || page < 1
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 100
    || (page - 1) * limit > Number.MAX_SAFE_INTEGER) {
    throw createError({ statusCode: 400, statusMessage: 'page and limit must be positive integers (limit <= 100)' })
  }
  return { page, limit }
}

export function csvCell(value: unknown) {
  let text = value == null ? '' : value instanceof Date ? value.toISOString() : String(value)
  // Quoting alone does not stop spreadsheet applications from evaluating formulas.
  if (typeof value === 'string' && (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text))) text = `'${text}`
  return `"${text.replaceAll('"', '""')}"`
}

export function csvPhone(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') return value
  const phone = String(value).trim()
  if (!/^\+?[\d(][\d(). -]*$/.test(phone)) return value
  let digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
  else if (digits.length !== 10 || phone.startsWith('+')) return value
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
}
