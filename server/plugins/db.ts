export default defineNitroPlugin(async () => {
  try {
    await connectDb()
    console.log('Connected to MongoDB')
    const { migrateCycleRoundsToApplications } = await import('../utils/migrateRounds')
    await migrateCycleRoundsToApplications().catch((error: unknown) => {
      console.error('Round migration failed:', error instanceof Error ? error.message : String(error))
    })
  } catch (error: unknown) {
    console.error('Failed to connect to MongoDB:', error instanceof Error ? error.message : String(error))
  }
})
