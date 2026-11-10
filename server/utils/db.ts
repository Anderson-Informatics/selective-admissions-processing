import mongoose from 'mongoose'

let _connecting: Promise<typeof mongoose> | null = null

const RETRY_DELAYS_MS = [500, 1000, 2000]

function isTransientConnectError(error: unknown): boolean {
  const err = error as { name?: string, code?: string, message?: string }
  if (err?.name === 'MongoServerSelectionError' || err?.name === 'MongoNetworkError') return true
  const code = err?.code ?? ''
  if (['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EHOSTUNREACH', 'EAI_AGAIN'].includes(code)) return true
  return /connection (timed out|reset|closed)|server selection|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(err?.message ?? '')
}

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose
  if (_connecting) return _connecting

  const uri = useRuntimeConfig().mongodbUri
  if (!uri) {
    throw new Error('NUXT_MONGODB_URI is not set')
  }

  const connecting = (async () => {
    let lastError: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await mongoose.connect(uri, { bufferCommands: false })
      } catch (error) {
        lastError = error
        if (attempt === RETRY_DELAYS_MS.length || !isTransientConnectError(error)) throw error
        console.warn(`MongoDB connect attempt ${attempt + 1} failed (${(error as Error).message}); retrying in ${RETRY_DELAYS_MS[attempt]}ms`)
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS_MS[attempt]))
      }
    }
    throw lastError
  })()
  _connecting = connecting

  try {
    return await connecting
  } finally {
    _connecting = null
  }
}
