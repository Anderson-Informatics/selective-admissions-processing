<script setup lang="ts">
interface School { id: string, name: string, aliases: string[], active: boolean }
interface Representative { userId: string, schoolIds: string[], active: boolean }
interface Authority { schoolId: string, userId: string, applicationId: string, version: number }
interface Directory { choiceSuggestions: string[], schools: School[], representatives: Representative[], members: { userId: string, name: string, title?: string, email?: string }[], authorities: Authority[] }
const toast = useToast()
const cycleId = ref('')
const applicationId = ref('')
const { data: cycles } = await useFetch<{ _id: string, name: string, active: boolean }[]>('/api/cycles')
watchEffect(() => {
  if (!cycleId.value) cycleId.value = cycles.value?.find(cycle => cycle.active)?._id || ''
})
const { data: applications } = await useFetch<{ _id: string, name: string }[]>('/api/applications', { query: { cycleId } })
watch(cycleId, () => {
  applicationId.value = ''
})
const { data: directory, refresh } = await useFetch<Directory>('/api/admin/schools', { query: { cycleId, applicationId } })
const school = reactive({ id: '', name: '', aliases: '', active: true })
const representative = reactive({ userId: '', schoolIds: [] as string[], active: true })
const authority = reactive({ schoolId: '', userId: '' })
const saving = ref(false)
const suggestedChoice = ref('')
const schools = computed(() => (directory.value?.schools || []).map(item => ({ label: `${item.name}${item.active ? '' : ' (inactive)'}`, value: item.id })))
const members = computed(() => {
  const entries = new Map((directory.value?.members || []).map(item => [item.userId, { label: [item.name || item.userId, item.title, item.email].filter(Boolean).join(' - '), value: item.userId }]))
  for (const rep of directory.value?.representatives || []) if (!entries.has(rep.userId)) entries.set(rep.userId, { label: `${rep.userId} (metadata missing)`, value: rep.userId })
  return [...entries.values()]
})
async function save(url: string, body: Record<string, unknown>) {
  saving.value = true
  try {
    await $fetch(url, { method: 'POST', body })
    await refresh()
    toast.add({ title: 'School directory saved', color: 'success' })
  } catch (error) {
    toast.add({ title: (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Could not save school directory', color: 'error' })
  } finally { saving.value = false }
}
function editSchool(item: School) {
  Object.assign(school, { ...item, aliases: item.aliases.join('\n') })
}
watch(() => representative.userId, (userId) => {
  const existing = directory.value?.representatives.find(rep => rep.userId === userId)
  representative.schoolIds = [...(existing?.schoolIds || [])]
  representative.active = existing?.active ?? true
})
const eligibleMembers = computed(() => members.value.filter(member => directory.value?.representatives.some(rep => rep.active && rep.userId === member.value && rep.schoolIds.includes(authority.schoolId))))
</script>

<template>
  <UCard class="space-y-4">
    <template #header>
      <h2 class="font-semibold">
        Schools and Submittable representatives
      </h2>
    </template>
    <p class="text-sm text-muted">
      These associations do not create site accounts or grant access. School names and aliases match application choices exactly, ignoring case and extra whitespace.
    </p>
    <div class="grid gap-6 lg:grid-cols-2 mt-4">
      <section class="space-y-3">
        <h3 class="font-medium">
          Shared schools
        </h3>
        <div class="flex flex-wrap gap-2">
          <UButton
            v-for="item in directory?.schools"
            :key="item.id"
            variant="soft"
            :label="`${item.name}${item.active ? '' : ' (inactive)'}`"
            @click="editSchool(item)"
          />
          <UButton
            label="New school"
            variant="outline"
            @click="Object.assign(school, { id: '', name: '', aliases: '', active: true })"
          />
        </div>
        <UFormField label="School name">
          <UInput
            v-model="school.name"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Observed school choices (selected cycle; suggestions only)">
          <div class="flex gap-2">
            <USelectMenu
              v-model="suggestedChoice"
              :items="directory?.choiceSuggestions || []"
              class="w-full"
            />
            <UButton
              label="Add alias"
              :disabled="!suggestedChoice"
              @click="school.aliases = [school.aliases, suggestedChoice].filter(Boolean).join('\n')"
            />
          </div>
        </UFormField>
        <UFormField label="Choice aliases (one per line)">
          <UTextarea
            v-model="school.aliases"
            class="w-full"
          />
        </UFormField>
        <UCheckbox
          v-model="school.active"
          label="Active school"
        />
        <UButton
          label="Save school"
          :loading="saving"
          :disabled="!school.name.trim()"
          @click="save('/api/admin/schools', { ...school, id: school.id || undefined, aliases: school.aliases.split('\n').map(value => value.trim()).filter(Boolean) })"
        />
      </section>
      <section class="space-y-3">
        <h3 class="font-medium">
          Shared representative affiliations
        </h3>
        <UFormField label="Submittable team member">
          <USelectMenu
            v-model="representative.userId"
            :items="members"
            value-key="value"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Associated schools">
          <USelectMenu
            v-model="representative.schoolIds"
            :items="schools"
            value-key="value"
            multiple
            class="w-full"
          />
        </UFormField>
        <UCheckbox
          v-model="representative.active"
          label="Active representative"
        />
        <UButton
          label="Save affiliation"
          :loading="saving"
          :disabled="!representative.userId"
          @click="save('/api/admin/school-representatives', representative)"
        />
        <ul class="text-sm space-y-1">
          <li
            v-for="rep in directory?.representatives"
            :key="rep.userId"
          >
            {{ members.find(member => member.value === rep.userId)?.label }}: {{ rep.schoolIds.map(id => schools.find(school => school.value === id)?.label || id).join(', ') }} {{ rep.active ? '' : '(inactive)' }}
          </li>
        </ul>
      </section>
      <section class="space-y-3 lg:col-span-2">
        <h3 class="font-medium">
          Authoritative school decisions
        </h3>
        <p class="text-sm text-muted">
          Choose a cycle default or an application override. An override never silently falls back if its representative becomes inactive.
        </p>
        <div class="grid gap-3 sm:grid-cols-2">
          <UFormField label="Cycle">
            <USelect
              v-model="cycleId"
              :items="(cycles || []).map(cycle => ({ label: cycle.name, value: cycle._id }))"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Scope">
            <USelect
              v-model="applicationId"
              :items="[{ label: 'Cycle default (all applications)', value: '' }, ...(applications || []).map(app => ({ label: app.name, value: app._id }))]"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="School">
            <USelect
              v-model="authority.schoolId"
              :items="schools"
              value-key="value"
              class="w-full"
            />
          </UFormField>
          <UFormField label="Primary Submittable user">
            <USelectMenu
              v-model="authority.userId"
              :items="eligibleMembers"
              value-key="value"
              class="w-full"
            />
          </UFormField>
        </div>
        <UButton
          label="Save primary reviewer"
          :loading="saving"
          :disabled="!cycleId || !authority.schoolId || !eligibleMembers.some(member => member.value === authority.userId)"
          @click="save('/api/admin/school-representatives/authority', { ...authority, cycleId, applicationId })"
        />
        <ul class="text-sm space-y-1">
          <li
            v-for="item in directory?.authorities"
            :key="`${item.applicationId}:${item.schoolId}`"
          >
            {{ schools.find(school => school.value === item.schoolId)?.label || item.schoolId }} — {{ members.find(member => member.value === item.userId)?.label || item.userId }} ({{ item.applicationId ? 'application override' : 'cycle default' }}, version {{ item.version }})
          </li>
        </ul>
      </section>
    </div>
  </UCard>
</template>
