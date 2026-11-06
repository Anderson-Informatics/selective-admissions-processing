<script setup lang="ts">
interface LibraryEntry { match: string, text: string }
interface ResponseLibrary { _id: string, name: string, key: string, description?: string, entries: LibraryEntry[] }

const toast = useToast()
const { data: libraries, refresh } = await useFetch<ResponseLibrary[]>('/api/response-libraries', { default: () => [] })

const selectedId = ref<string | undefined>()
const saving = ref(false)
const deleting = ref(false)
const form = reactive({ name: '', key: '', description: '', entries: [] as LibraryEntry[] })

watch(selectedId, (id) => {
  const library = (libraries.value || []).find(item => item._id === id)
  form.name = library?.name || ''
  form.key = library?.key || ''
  form.description = library?.description || ''
  form.entries = (library?.entries || []).map(entry => ({ match: entry.match, text: entry.text }))
})

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

watch(() => form.name, (name) => {
  if (!selectedId.value) form.key = slugify(name)
})

function newLibrary() {
  selectedId.value = undefined
  form.name = ''
  form.key = ''
  form.description = ''
  form.entries = []
}

function addEntry() {
  form.entries.push({ match: '', text: '' })
}

function removeEntry(index: number) {
  form.entries.splice(index, 1)
}

async function save() {
  if (!form.name.trim()) {
    toast.add({ title: 'Library name is required', color: 'error' })
    return
  }
  saving.value = true
  try {
    const payload = { name: form.name, key: form.key, description: form.description, entries: form.entries }
    if (selectedId.value) {
      await $fetch(`/api/response-libraries/${selectedId.value}`, { method: 'PUT', body: payload })
    } else {
      const created = await $fetch<ResponseLibrary>('/api/response-libraries', { method: 'POST', body: payload })
      selectedId.value = created._id
    }
    await refresh()
    toast.add({ title: 'Library saved', color: 'success' })
  } catch (error: unknown) {
    toast.add({ title: (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Save failed', color: 'error' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!selectedId.value) return
  deleting.value = true
  try {
    await $fetch(`/api/response-libraries/${selectedId.value}`, { method: 'DELETE' })
    newLibrary()
    await refresh()
    toast.add({ title: 'Library deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Delete failed', color: 'error' })
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <UContainer class="py-8">
    <h1 class="text-2xl font-semibold mb-2">
      Response Libraries
    </h1>
    <p class="text-muted mb-6">
      Map stored option labels to alternate display text for message templates. Reference a library in a multi-select merge field with <code v-pre>{{Field | list | lib:key}}</code>. Options without a matching entry are omitted. Entry text may contain merge fields (e.g. <code v-pre>{{Stage.OtherField}}</code>) and HTML.
    </p>

    <div class="grid md:grid-cols-[240px_1fr] gap-6">
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <h2 class="font-medium">
            Libraries
          </h2>
          <UButton
            size="xs"
            label="New"
            icon="i-lucide-plus"
            @click="newLibrary"
          />
        </div>
        <ul
          v-if="libraries.length"
          class="text-sm divide-y border rounded-lg"
        >
          <li
            v-for="library in libraries"
            :key="library._id"
            class="px-3 py-2 cursor-pointer hover:bg-elevated"
            :class="{ 'bg-elevated font-medium': library._id === selectedId }"
            @click="selectedId = library._id"
          >
            {{ library.name }}
            <div class="text-xs text-muted">
              <code>{{ library.key }}</code>
            </div>
          </li>
        </ul>
        <p
          v-else
          class="text-sm text-muted"
        >
          No libraries yet.
        </p>
      </div>

      <div class="space-y-4">
        <div class="grid sm:grid-cols-2 gap-4">
          <UFormField label="Name">
            <UInput
              v-model="form.name"
              class="w-full"
            />
          </UFormField>
          <UFormField
            label="Key"
            hint="Used in tokens as lib:key"
          >
            <UInput
              v-model="form.key"
              class="w-full font-mono"
            />
          </UFormField>
        </div>
        <UFormField label="Description">
          <UInput
            v-model="form.description"
            class="w-full"
          />
        </UFormField>

        <div class="space-y-3">
          <div class="flex justify-between items-center">
            <h2 class="font-medium">
              Entries
            </h2>
            <UButton
              size="xs"
              label="Add entry"
              icon="i-lucide-plus"
              variant="outline"
              @click="addEntry"
            />
          </div>
          <p
            v-if="!form.entries.length"
            class="text-sm text-muted"
          >
            No entries yet. Each entry maps a stored option label (exact match) to the text rendered in its place.
          </p>
          <div
            v-for="(entry, index) in form.entries"
            :key="index"
            class="rounded-lg border p-3 space-y-2"
          >
            <div class="flex items-start gap-2">
              <UFormField
                label="Option label (match)"
                class="flex-1"
              >
                <UInput
                  v-model="entry.match"
                  class="w-full"
                  placeholder="e.g. Progress Report(s) submitted"
                />
              </UFormField>
              <UButton
                icon="i-lucide-trash-2"
                size="xs"
                color="error"
                variant="ghost"
                class="mt-6"
                aria-label="Remove entry"
                @click="removeEntry(index)"
              />
            </div>
            <UFormField label="Replacement text">
              <UTextarea
                v-model="entry.text"
                :rows="2"
                autoresize
                class="w-full"
                placeholder="Text rendered instead of the option label. Merge fields and HTML allowed."
              />
            </UFormField>
          </div>
        </div>

        <div class="flex gap-2">
          <UButton
            :label="selectedId ? 'Save library' : 'Create library'"
            :loading="saving"
            @click="save"
          />
          <UButton
            v-if="selectedId"
            label="Delete"
            color="error"
            variant="outline"
            :loading="deleting"
            @click="remove"
          />
        </div>
      </div>
    </div>
  </UContainer>
</template>
