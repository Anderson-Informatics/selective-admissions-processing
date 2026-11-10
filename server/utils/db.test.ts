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

  it('retries transient connection failures before resolving', async () => {
    vi.useFakeTimers()
    try {
      const error = new Error('connection closed')
      vi.mocked(mongoose.connect).mockRejectedValueOnce(error).mockResolvedValueOnce(mongoose)

      const pending = connectDb()
      await vi.runAllTimersAsync()
      await expect(pending).resolves.toBe(mongoose)
      connection.readyState = 1

      await expect(connectDb()).resolves.toBe(mongoose)
      expect(mongoose.connect).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('gives up after exhausting transient retries', async () => {
    vi.useFakeTimers()
    try {
      const error = new Error('ECONNRESET')
      vi.mocked(mongoose.connect).mockRejectedValue(error)

      const pending = connectDb()
      const assertion = expect(pending).rejects.toBe(error)
      await vi.runAllTimersAsync()
      await assertion
      expect(mongoose.connect).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry non-transient connection errors', async () => {
    const error = new Error('bad auth credentials')
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
