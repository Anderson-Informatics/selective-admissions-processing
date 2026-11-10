import { UserModel } from '../models/User'
import { hashPassword, validatePassword } from './password'

export async function seedBootstrapAdmin() {
  const { bootstrapAdminEmail, bootstrapAdminPassword } = useRuntimeConfig()
  if (!bootstrapAdminEmail) return

  const existing = await UserModel.estimatedDocumentCount()
  if (existing > 0) return

  const policyError = validatePassword(bootstrapAdminPassword)
  if (policyError) {
    console.error(`Bootstrap admin not created: ${policyError} (NUXT_BOOTSTRAP_ADMIN_PASSWORD)`)
    return
  }

  await UserModel.create({
    email: bootstrapAdminEmail,
    passwordHash: await hashPassword(bootstrapAdminPassword),
    role: 'site_admin'
  })
  console.log(`Bootstrap site admin created for ${bootstrapAdminEmail}`)
}
