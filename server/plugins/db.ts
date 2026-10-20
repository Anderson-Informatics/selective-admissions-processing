export default defineNitroPlugin(async () => {
  try {
    await connectDb()
    console.log('Connected to MongoDB')
  } catch (error: unknown) {
    console.error('Failed to connect to MongoDB:', error instanceof Error ? error.message : String(error))
  }
})
