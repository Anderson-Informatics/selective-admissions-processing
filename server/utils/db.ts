import mongoose from 'mongoose'

let _connecting: Promise<typeof mongoose> | null = null

export async function connectDb() {
  if (mongoose.connection.readyState === 1) return mongoose
  if (_connecting) return _connecting

  const uri = useRuntimeConfig().mongodbUri
  if (!uri) {
    throw new Error('NUXT_MONGODB_URI is not set')
  }

  const connecting = mongoose.connect(uri, {
    bufferCommands: false
  })
  _connecting = connecting

  try {
    return await connecting
  } finally {
    _connecting = null
  }
}
