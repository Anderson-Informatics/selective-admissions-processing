<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

interface AdminUser {
  _id: string
  email: string
  role: 'site_admin' | 'central_admin'
  status: 'active' | 'disabled'
  passwordResetRequestedAt?: string
  lastLoginAt?: string
  createdAt?: string
}

interface PendingInvite {
  _id: string
  email: string
  role: string
  createdBy: string
  expiresAt: string
}

const toast = useToast()
const auth = useAuth()

const { data: usersData, refresh: refreshUsers, status } = await useFetch<{ users: AdminUser[] }>('/api/admin/users')
const { data: invitesData, refresh: refreshInvites } = await useFetch<{ invites: PendingInvite[] }>('/api/admin/users/invites')
const users = computed(() => usersData.value?.users ?? [])
const invites = computed(() => invitesData.value?.invites ?? [])

const inviteEmail = ref('')
const inviteRole = ref<'central_admin' | 'site_admin'>('central_admin')
const inviteLoading = ref(false)
const generatedLink = ref('')

const resetLinkFor = ref<AdminUser | null>(null)
const resetLink = ref('')
const resetLoading = ref<string | null>(null)

async function copyLink(link: string) {
  try {
    await navigator.clipboard.writeText(link)
    toast.add({ title: 'Link copied to clipboard', color: 'success' })
  } catch {
    toast.add({ title: 'Copy failed — select and copy the link manually', color: 'error' })
  }
}

async function sendInvite() {
  inviteLoading.value = true
  generatedLink.value = ''
  try {
    const result = await $fetch<{ inviteUrl: string }>('/api/admin/users/invite', {
      method: 'POST',
      body: { email: inviteEmail.value, role: inviteRole.value }
    })
    generatedLink.value = result.inviteUrl
    inviteEmail.value = ''
    await refreshInvites()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to create invitation',
      color: 'error'
    })
  }
  inviteLoading.value = false
}

async function revokeInvite(invite: PendingInvite) {
  try {
    await $fetch(`/api/admin/users/invites/${invite._id}`, { method: 'DELETE' })
    toast.add({ title: `Invitation for ${invite.email} revoked`, color: 'success' })
    await refreshInvites()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to revoke invitation',
      color: 'error'
    })
  }
}

async function generateResetLink(user: AdminUser) {
  resetLoading.value = user._id
  resetLinkFor.value = null
  resetLink.value = ''
  try {
    const result = await $fetch<{ resetUrl: string }>(`/api/admin/users/${user._id}/reset-link`, { method: 'POST' })
    resetLinkFor.value = user
    resetLink.value = result.resetUrl
    await refreshUsers()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to create reset link',
      color: 'error'
    })
  }
  resetLoading.value = null
}

async function patchUser(user: AdminUser, body: { role?: string, status?: string }) {
  try {
    await $fetch(`/api/admin/users/${user._id}`, { method: 'PATCH', body })
    toast.add({ title: `Updated ${user.email}`, color: 'success' })
    await refreshUsers()
  } catch (err: unknown) {
    toast.add({
      title: (err as { data?: { statusMessage?: string } }).data?.statusMessage || 'Failed to update user',
      color: 'error'
    })
  }
}

function toggleRole(user: AdminUser) {
  return patchUser(user, { role: user.role === 'site_admin' ? 'central_admin' : 'site_admin' })
}

function toggleStatus(user: AdminUser) {
  return patchUser(user, { status: user.status === 'active' ? 'disabled' : 'active' })
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString() : '—'
}

const columns: TableColumn<AdminUser>[] = [
  { accessorKey: 'email', header: 'Email' },
  { id: 'role', accessorKey: 'role', header: 'Role' },
  { id: 'status', accessorKey: 'status', header: 'Status' },
  { id: 'flags', header: 'Flags' },
  { accessorKey: 'lastLoginAt', header: 'Last sign-in' },
  { id: 'actions', header: 'Actions', enableSorting: false }
]

const inviteColumns: TableColumn<PendingInvite>[] = [
  { accessorKey: 'email', header: 'Email' },
  { id: 'role', accessorKey: 'role', header: 'Role' },
  { accessorKey: 'createdBy', header: 'Invited by' },
  { accessorKey: 'expiresAt', header: 'Expires' },
  { id: 'actions', header: '', enableSorting: false }
]
</script>

<template>
  <UContainer class="py-8 space-y-8">
    <PageHeader
      title="User Management"
      help="users"
    />

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Invite a user
        </h2>
      </template>

      <form
        class="flex flex-wrap items-end gap-3"
        @submit.prevent="sendInvite"
      >
        <UFormField
          label="Email"
          class="grow min-w-56"
        >
          <UInput
            v-model="inviteEmail"
            type="email"
            placeholder="user@example.com"
            required
          />
        </UFormField>
        <UFormField label="Role">
          <USelect
            v-model="inviteRole"
            :items="[
              { label: 'Central office admin', value: 'central_admin' },
              { label: 'Site admin', value: 'site_admin' }
            ]"
            class="w-52"
          />
        </UFormField>
        <UButton
          type="submit"
          icon="i-lucide-plus"
          label="Create invite link"
          :loading="inviteLoading"
        />
      </form>

      <div
        v-if="generatedLink"
        class="mt-4 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2"
      >
        <p class="text-sm">
          Invitation created. Send this link to the user — it is only shown here:
        </p>
        <div class="flex gap-2">
          <UInput
            :model-value="generatedLink"
            readonly
            class="grow font-mono text-xs"
          />
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="outline"
            label="Copy"
            @click="copyLink(generatedLink)"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Users
        </h2>
      </template>

      <UTable
        :data="users"
        :columns="columns"
        :loading="status === 'pending'"
      >
        <template #role-cell="{ row }">
          <UBadge
            :label="row.original.role === 'site_admin' ? 'Site admin' : 'Central office admin'"
            :color="row.original.role === 'site_admin' ? 'primary' : 'neutral'"
            variant="subtle"
          />
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :label="row.original.status"
            :color="row.original.status === 'active' ? 'success' : 'error'"
            variant="subtle"
          />
        </template>

        <template #flags-cell="{ row }">
          <UBadge
            v-if="row.original.passwordResetRequestedAt"
            label="Reset requested"
            color="warning"
            variant="subtle"
          />
        </template>

        <template #lastLoginAt-cell="{ row }">
          {{ formatDate(row.original.lastLoginAt) }}
        </template>

        <template #actions-cell="{ row }">
          <div class="flex gap-1">
            <UTooltip text="Generate password reset link">
              <UButton
                icon="i-lucide-key-round"
                color="neutral"
                variant="ghost"
                :loading="resetLoading === row.original._id"
                @click="generateResetLink(row.original)"
              />
            </UTooltip>
            <UTooltip text="Toggle role">
              <UButton
                icon="i-lucide-shield"
                color="neutral"
                variant="ghost"
                :disabled="row.original.email === auth.user.value?.email"
                @click="toggleRole(row.original)"
              />
            </UTooltip>
            <UTooltip :text="row.original.status === 'active' ? 'Disable account' : 'Enable account'">
              <UButton
                :icon="row.original.status === 'active' ? 'i-lucide-ban' : 'i-lucide-check'"
                :color="row.original.status === 'active' ? 'error' : 'success'"
                variant="ghost"
                @click="toggleStatus(row.original)"
              />
            </UTooltip>
          </div>
        </template>
      </UTable>

      <div
        v-if="resetLink && resetLinkFor"
        class="mt-4 rounded-md border border-warning/30 bg-warning/5 p-3 space-y-2"
      >
        <p class="text-sm">
          Reset link for <strong>{{ resetLinkFor.email }}</strong> — send it manually:
        </p>
        <div class="flex gap-2">
          <UInput
            :model-value="resetLink"
            readonly
            class="grow font-mono text-xs"
          />
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="outline"
            label="Copy"
            @click="copyLink(resetLink)"
          />
        </div>
      </div>
    </UCard>

    <UCard>
      <template #header>
        <h2 class="font-semibold">
          Pending invitations
        </h2>
      </template>

      <UTable
        :data="invites"
        :columns="inviteColumns"
      >
        <template #role-cell="{ row }">
          <UBadge
            :label="row.original.role === 'site_admin' ? 'Site admin' : 'Central office admin'"
            :color="row.original.role === 'site_admin' ? 'primary' : 'neutral'"
            variant="subtle"
          />
        </template>

        <template #expiresAt-cell="{ row }">
          {{ formatDate(row.original.expiresAt) }}
        </template>

        <template #actions-cell="{ row }">
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            aria-label="Revoke"
            @click="revokeInvite(row.original)"
          />
        </template>
      </UTable>
    </UCard>
  </UContainer>
</template>
