export default defineNitroPlugin(async () => {
  try {
    await connectDb()
    console.log('Connected to MongoDB')
    const { migrateCycleRoundsToApplications } = await import('../utils/migrateRounds')
    await migrateCycleRoundsToApplications().catch((error: unknown) => {
      console.error('Round migration failed:', error instanceof Error ? error.message : String(error))
    })
    const { migrateOptInPartialStatus } = await import('../utils/migrateOptInPartialStatus')
    await migrateOptInPartialStatus().catch((error: unknown) => {
      console.error('Opt-In Partial status migration failed:', error instanceof Error ? error.message : String(error))
    })
    const { migrateDpscdSchoolFields } = await import('../utils/migrateDpscdSchoolFields')
    await migrateDpscdSchoolFields().catch((error: unknown) => {
      console.error('DPSCD school field migration failed:', error instanceof Error ? error.message : String(error))
    })
  } catch (error: unknown) {
    console.error('Failed to connect to MongoDB:', error instanceof Error ? error.message : String(error))
  }
})
