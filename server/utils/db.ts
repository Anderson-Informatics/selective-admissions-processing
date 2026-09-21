import mongoose from 'mongoose'

let _connecting: Promise<typeof mongoose> | null = null

export async function connectDb() {
  if (_connecting) return _connecting

  const uri = useRuntimeConfig().mongodbUri
  if (!uri) {
    throw new Error('NUXT_MONGODB_URI is not set')
  }

  _connecting = mongoose.connect(uri, {
    bufferCommands: false
  })

  return _connecting
}
