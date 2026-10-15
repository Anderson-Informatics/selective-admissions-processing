import mongoose from 'mongoose'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDb } from './db'

const connection = vi.hoisted(() => ({ readyState: 0 }))

vi.mock('mongoose', () => ({
  default: {
    connection,
    connect: vi.fn()
  }
}))

beforeEach(() => {
  vi.resetAllMocks()
  connection.readyState = 0
  vi.stubGlobal('useRuntimeConfig', () => ({ mongodbUri: 'mongodb://example.test/db' }))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('connectDb', () => {
  it('shares an in-flight connection between requests', async () => {
    let resolveConnection!: (value: typeof mongoose) => void
    vi.mocked(mongoose.connect).mockReturnValue(new Promise((resolve) => {
      resolveConnection = resolve
    }))

    const first = connectDb()
    const second = connectDb()
    expect(mongoose.connect).toHaveBeenCalledTimes(1)
    expect(mongoose.connect).toHaveBeenCalledWith('mongodb://example.test/db', { bufferCommands: false })

    connection.readyState = 1
    resolveConnection(mongoose)
    await expect(Promise.all([first, second])).resolves.toEqual([mongoose, mongoose])
    await expect(connectDb()).resolves.toBe(mongoose)
    expect(mongoose.connect).toHaveBeenCalledTimes(1)
  })

  it('retries on the next request after a failed connection', async () => {
    const error = new Error('connection closed')
    vi.mocked(mongoose.connect).mockRejectedValueOnce(error).mockResolvedValueOnce(mongoose)

    await expect(connectDb()).rejects.toBe(error)
    await expect(connectDb()).resolves.toBe(mongoose)
    expect(mongoose.connect).toHaveBeenCalledTimes(2)
  })

  it('reconnects when a previously established connection is disconnected', async () => {
    vi.mocked(mongoose.connect).mockResolvedValue(mongoose)

    await connectDb()
    connection.readyState = 1
    await connectDb()
    expect(mongoose.connect).toHaveBeenCalledTimes(1)

    connection.readyState = 0
    await connectDb()
    expect(mongoose.connect).toHaveBeenCalledTimes(2)
  })

  it('reports missing configuration without starting a connection', async () => {
    vi.stubGlobal('useRuntimeConfig', () => ({ mongodbUri: '' }))

    await expect(connectDb()).rejects.toThrow('NUXT_MONGODB_URI is not set')
    expect(mongoose.connect).not.toHaveBeenCalled()
  })
})
