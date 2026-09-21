export default defineNitroPlugin(async () => {
  try {
    await connectDb()
    console.log('Connected to MongoDB')
  } catch (error: any) {
    console.error('Failed to connect to MongoDB:', error.message)
  }
})
