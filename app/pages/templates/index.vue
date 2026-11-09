<script setup lang="ts">
import type { EditorToolbarItem } from '@nuxt/ui'

interface MergeFieldEditor { chain: () => { focus: () => { insertContent: (content: string) => { run: () => void } } } }

interface MessageTemplate { _id: string, name: string, description?: string, subject: string, bodyHtml: string }

interface MergeFieldSource {
  key: string
  label: string
  kind: 'submission' | 'review' | 'builtin'
  stageName?: string
  fields: Array<{ value: string, label: string, questionText?: string, fieldType?: string, token: string }>
}

interface ResponseLibraryOption { _id: string, name: string, key: string }

type InsertFormat = 'list' | 'numbered' | 'comma' | 'raw'

const LIST_FIELD_TYPES = new Set(['multiple_response', 'file_upload'])

interface CycleOption { _id: string, name: string, year: string, active: boolean }

const toast = useToast()
const { data: templates, refresh } = await useFetch<MessageTemplate[]>('/api/templates', { default: () => [] })
const { data: cycles } = await useFetch<CycleOption[]>('/api/cycles', { default: () => [] })
const { data: responseLibraries } = await useFetch<ResponseLibraryOption[]>('/api/response-libraries', { default: () => [] })
const libraryItems = computed(() => (responseLibraries.value || []).map(library => ({ label: library.name, value: library.key })))

const mergeCycleId = ref<string | undefined>()
const { data: mergeFieldData } = await useFetch<{ cycleId: string | null, sources: MergeFieldSource[] }>('/api/templates/merge-fields', {
  query: computed(() => (mergeCycleId.value ? { cycleId: mergeCycleId.value } : {})),
  default: () => ({ cycleId: null, sources: [] })
})
watch(() => mergeFieldData.value.cycleId, (id) => {
  if (id && !mergeCycleId.value) mergeCycleId.value = id
}, { immediate: true })

const cycleItems = computed(() => (cycles.value || []).map(cycle => ({ label: `${cycle.name}${cycle.active ? ' (active)' : ''}`, value: cycle._id })))
const sourceItems = computed(() => mergeFieldData.value.sources.map(source => ({ label: source.label, value: source.key })))
const mergeSourceKey = ref('submission')
const mergeFieldValue = ref<string | undefined>()
const selectedSource = computed(() => mergeFieldData.value.sources.find(source => source.key === mergeSourceKey.value))
const fieldItems = computed(() => (selectedSource.value?.fields || []).map(field => ({
  label: field.label,
  value: field.token,
  description: field.questionText && field.questionText !== field.label ? field.questionText : undefined,
  multi: LIST_FIELD_TYPES.has(field.fieldType || '')
})))
watch(() => mergeFieldData.value.sources, (sources) => {
  if (!sources.some(source => source.key === mergeSourceKey.value)) mergeSourceKey.value = 'submission'
})
watch(mergeSourceKey, () => {
  mergeFieldValue.value = undefined
  pendingListToken.value = undefined
  pendingDeadline.value = false
})

const insertFormatItems = [
  { label: 'Bulleted list', value: 'list' },
  { label: 'Numbered list', value: 'numbered' },
  { label: 'Inline (comma)', value: 'comma' },
  { label: 'Raw text', value: 'raw' }
]
const pendingListToken = ref<string | undefined>()
const insertFormat = ref<InsertFormat>('list')
const insertLibrary = ref<string | undefined>()
const pendingIsMulti = computed(() => Boolean(fieldItems.value.find(item => item.value === pendingListToken.value)?.multi))

const pendingDeadline = ref(false)
const deadlineCount = ref(2)
const deadlineUnit = ref<'days' | 'weeks' | 'business-days'>('weeks')
const deadlineSnap = ref<string | undefined>()
const deadlineUnitItems = [
  { label: 'calendar days', value: 'days' },
  { label: 'calendar weeks', value: 'weeks' },
  { label: 'business days', value: 'business-days' }
]
const deadlineSnapItems = [
  { label: 'No snap', value: '' },
  { label: 'Snap to Monday', value: 'monday' },
  { label: 'Snap to Tuesday', value: 'tuesday' },
  { label: 'Snap to Wednesday', value: 'wednesday' },
  { label: 'Snap to Thursday', value: 'thursday' },
  { label: 'Snap to Friday', value: 'friday' },
  { label: 'Snap to Saturday', value: 'saturday' },
  { label: 'Snap to Sunday', value: 'sunday' }
]
const deadlineToken = computed(() => {
  const count = Math.max(0, Number(deadlineCount.value) || 0)
  const spec = deadlineUnit.value === 'business-days' ? `${count} business days` : `${count} ${deadlineUnit.value}`
  const snap = deadlineSnap.value ? ` | snap ${deadlineSnap.value}` : ''
  return `{{deadline | ${spec}${snap}}}`
})

function onFieldSelected(token: string | undefined) {
  if (!token) return
  if (token === '{{deadline}}') {
    pendingDeadline.value = true
    return
  }
  const fieldItem = fieldItems.value.find(item => item.value === token)
  if (fieldItem?.multi || libraryItems.value.length) {
    pendingListToken.value = token
    insertFormat.value = fieldItem?.multi ? 'list' : 'raw'
    return
  }
  insertMergeField(token)
}

function insertPendingDeadline() {
  insertMergeField(deadlineToken.value)
  pendingDeadline.value = false
  mergeFieldValue.value = undefined
}

function cancelPendingDeadline() {
  pendingDeadline.value = false
  mergeFieldValue.value = undefined
}

const pendingInsertPreview = computed(() => {
  const token = pendingListToken.value
  if (!token) return ''
  let body = token.slice(0, -2)
  if (insertFormat.value !== 'raw') body += ` | ${insertFormat.value}`
  if (insertLibrary.value) body += ` | lib:${insertLibrary.value}`
  return `${body}}}`
})

function insertPendingListField() {
  const token = pendingListToken.value
  if (!token) return
  insertMergeField(pendingInsertPreview.value, insertFormat.value === 'list' || insertFormat.value === 'numbered')
  pendingListToken.value = undefined
  insertLibrary.value = undefined
}

function cancelPendingListField() {
  pendingListToken.value = undefined
  insertLibrary.value = undefined
  mergeFieldValue.value = undefined
}

const editorRef = useTemplateRef<{ editor?: MergeFieldEditor }>('editorRef')
const sourceTextareaRef = useTemplateRef<{ textareaRef?: HTMLTextAreaElement }>('sourceTextareaRef')

function insertMergeField(rawToken: string | undefined, asBlock = false) {
  if (!rawToken) return
  const token = asBlock ? `<p>${rawToken}</p>` : rawToken
  if (editorMode.value === 'visual') {
    editorRef.value?.editor?.chain().focus().insertContent(token).run()
  } else {
    const textarea = sourceTextareaRef.value?.textareaRef
    const start = textarea?.selectionStart ?? form.bodyHtml.length
    const end = textarea?.selectionEnd ?? start
    form.bodyHtml = form.bodyHtml.slice(0, start) + token + form.bodyHtml.slice(end)
    nextTick(() => {
      textarea?.focus()
      textarea?.setSelectionRange(start + token.length, start + token.length)
    })
  }
  nextTick(() => {
    mergeFieldValue.value = undefined
  })
}

const selectedId = ref<string | undefined>()
const saving = ref(false)
const deleting = ref(false)
const form = reactive({ name: '', description: '', subject: '', bodyHtml: '' })

const editorMode = ref<'visual' | 'html'>('visual')
const editorModeItems = [
  { label: 'Visual', value: 'visual', icon: 'i-lucide-type' },
  { label: 'HTML', value: 'html', icon: 'i-lucide-code' }
]

const toolbarItems: EditorToolbarItem[][] = [
  [
    { kind: 'undo', icon: 'i-lucide-undo', tooltip: { text: 'Undo' } },
    { kind: 'redo', icon: 'i-lucide-redo', tooltip: { text: 'Redo' } }
  ],
  [
    { kind: 'paragraph', icon: 'i-lucide-pilcrow', tooltip: { text: 'Paragraph' } },
    { kind: 'heading', level: 2, icon: 'i-lucide-heading-2', tooltip: { text: 'Heading 2' } },
    { kind: 'heading', level: 3, icon: 'i-lucide-heading-3', tooltip: { text: 'Heading 3' } }
  ],
  [
    { kind: 'mark', mark: 'bold', icon: 'i-lucide-bold', tooltip: { text: 'Bold' } },
    { kind: 'mark', mark: 'italic', icon: 'i-lucide-italic', tooltip: { text: 'Italic' } },
    { kind: 'mark', mark: 'underline', icon: 'i-lucide-underline', tooltip: { text: 'Underline' } },
    { kind: 'mark', mark: 'strike', icon: 'i-lucide-strikethrough', tooltip: { text: 'Strikethrough' } }
  ],
  [
    { kind: 'bulletList', icon: 'i-lucide-list', tooltip: { text: 'Bullet list' } },
    { kind: 'orderedList', icon: 'i-lucide-list-ordered', tooltip: { text: 'Numbered list' } },
    { kind: 'blockquote', icon: 'i-lucide-text-quote', tooltip: { text: 'Quote' } },
    { kind: 'horizontalRule', icon: 'i-lucide-separator-horizontal', tooltip: { text: 'Divider' } }
  ],
  [
    { kind: 'link', icon: 'i-lucide-link', tooltip: { text: 'Link' } },
    { kind: 'clearFormatting', icon: 'i-lucide-remove-formatting', tooltip: { text: 'Clear formatting' } }
  ]
]

const shortcutTips = [
  { keys: 'Ctrl/⌘ + B', effect: 'Bold' },
  { keys: 'Ctrl/⌘ + I', effect: 'Italic' },
  { keys: 'Ctrl/⌘ + U', effect: 'Underline' },
  { keys: 'Ctrl/⌘ + Shift + S', effect: 'Strikethrough' },
  { keys: 'Ctrl/⌘ + Z', effect: 'Undo' },
  { keys: 'Ctrl/⌘ + Shift + Z', effect: 'Redo' },
  { keys: 'Shift + Enter', effect: 'Line break' }
]

const markdownTips = [
  { keys: '## ', effect: 'Heading 2' },
  { keys: '### ', effect: 'Heading 3' },
  { keys: '- or * ', effect: 'Bullet list' },
  { keys: '1. ', effect: 'Numbered list' },
  { keys: '> ', effect: 'Quote' },
  { keys: '---', effect: 'Divider' },
  { keys: '**text**', effect: 'Bold' },
  { keys: '*text*', effect: 'Italic' },
  { keys: '~~text~~', effect: 'Strikethrough' }
]

watch(selectedId, (id) => {
  const template = (templates.value || []).find(item => item._id === id)
  form.name = template?.name || ''
  form.description = template?.description || ''
  form.subject = template?.subject || ''
  form.bodyHtml = template?.bodyHtml || ''
})

function newTemplate() {
  selectedId.value = undefined
  form.name = ''
  form.description = ''
  form.subject = ''
  form.bodyHtml = ''
}

async function save() {
  if (!form.name.trim()) {
    toast.add({ title: 'Template name is required', color: 'error' })
    return
  }
  saving.value = true
  try {
    if (selectedId.value) {
      await $fetch(`/api/templates/${selectedId.value}`, { method: 'PUT', body: { ...form } })
    } else {
      const created = await $fetch<MessageTemplate>('/api/templates', { method: 'POST', body: { ...form } })
      selectedId.value = created._id
    }
    await refresh()
    toast.add({ title: 'Template saved', color: 'success' })
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
    await $fetch(`/api/templates/${selectedId.value}`, { method: 'DELETE' })
    newTemplate()
    await refresh()
    toast.add({ title: 'Template deleted', color: 'success' })
  } catch {
    toast.add({ title: 'Delete failed', color: 'error' })
  } finally {
    deleting.value = false
  }
}

const previewSubmissionId = ref('')
const previewLoading = ref(false)
const sendLoading = ref(false)
const preview = ref<{ subject: string, bodyHtml: string, unresolved: string[], unknownFormats: string[], unknownLibraries: string[] } | null>(null)

async function renderPreview() {
  if (!previewSubmissionId.value.trim()) return
  previewLoading.value = true
  try {
    preview.value = await $fetch('/api/templates/render', {
      method: 'POST',
      body: { submissionId: previewSubmissionId.value.trim(), subject: form.subject, bodyHtml: form.bodyHtml }
    })
  } catch (error: unknown) {
    preview.value = null
    toast.add({ title: (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Preview failed', color: 'error' })
  } finally {
    previewLoading.value = false
  }
}

async function sendTest() {
  if (!previewSubmissionId.value.trim()) return
  sendLoading.value = true
  try {
    const result = await $fetch<{ sent: boolean, subject: string, unresolved: string[], unknownFormats: string[], unknownLibraries: string[] }>('/api/templates/send', {
      method: 'POST',
      body: { submissionId: previewSubmissionId.value.trim(), subject: form.subject, bodyHtml: form.bodyHtml }
    })
    const warnings = [...result.unresolved, ...result.unknownFormats, ...result.unknownLibraries]
    toast.add({
      title: `Message sent to submission ${previewSubmissionId.value.trim()}`,
      description: warnings.length ? `Sent with warnings: ${warnings.join(', ')}` : undefined,
      color: warnings.length ? 'warning' : 'success'
    })
  } catch (error: unknown) {
    toast.add({ title: (error as { data?: { statusMessage?: string } }).data?.statusMessage || 'Send failed', color: 'error' })
  } finally {
    sendLoading.value = false
  }
}
</script>

<template>
  <UContainer class="py-8">
    <PageHeader
      title="Message Templates"
      help="templates"
      class="mb-2"
    />
    <p class="text-muted mb-6">
      Reusable email messages for routing Open-for-Editing actions. Use <code v-pre>{{Field}}</code> for submission fields and <code v-pre>{{Stage Name.Field}}</code> for review form fields. The Computed source adds link and deadline tokens.
    </p>

    <div class="grid md:grid-cols-[240px_1fr] xl:grid-cols-[240px_1fr_300px] gap-6">
      <div class="space-y-3">
        <div class="flex justify-between items-center">
          <h2 class="font-medium">
            Templates
          </h2>
          <UButton
            size="xs"
            label="New"
            icon="i-lucide-plus"
            @click="newTemplate"
          />
        </div>
        <ul
          v-if="templates.length"
          class="text-sm divide-y border rounded-lg"
        >
          <li
            v-for="template in templates"
            :key="template._id"
            class="px-3 py-2 cursor-pointer hover:bg-elevated"
            :class="{ 'bg-elevated font-medium': template._id === selectedId }"
            @click="selectedId = template._id"
          >
            {{ template.name }}
          </li>
        </ul>
        <p
          v-else
          class="text-sm text-muted"
        >
          No templates yet.
        </p>
      </div>

      <div class="space-y-4">
        <UFormField label="Name">
          <UInput
            v-model="form.name"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Description">
          <UInput
            v-model="form.description"
            class="w-full"
          />
        </UFormField>
        <UFormField label="Subject">
          <UInput
            v-model="form.subject"
            class="w-full"
            placeholder="Subject line — merge fields supported"
          />
        </UFormField>
        <UFormField label="Body">
          <template #hint>
            <UTabs
              v-model="editorMode"
              :items="editorModeItems"
              :content="false"
              size="xs"
            />
          </template>
          <div class="space-y-2 mb-3">
            <div class="flex items-center gap-2">
              <span class="text-sm text-muted whitespace-nowrap">Insert merge field from:</span>
              <USelect
                v-model="mergeCycleId"
                :items="cycleItems"
                placeholder="Cycle"
                :disabled="cycleItems.length < 2"
                class="flex-1"
              />
            </div>
            <USelect
              v-model="mergeSourceKey"
              :items="sourceItems"
              placeholder="Source"
              class="w-full"
            />
            <USelectMenu
              v-model="mergeFieldValue"
              :items="fieldItems"
              value-key="value"
              :placeholder="fieldItems.length ? 'Choose a field' : 'No mapped fields'"
              :disabled="!fieldItems.length"
              class="w-full"
              @update:model-value="onFieldSelected"
            >
              <template #item-trailing="{ item }">
                <UBadge
                  v-if="item.multi"
                  label="multi-select"
                  size="sm"
                  variant="subtle"
                  color="info"
                />
              </template>
            </USelectMenu>
            <div
              v-if="pendingListToken"
              class="space-y-2 rounded-lg border p-3"
            >
              <div
                v-if="pendingIsMulti"
                class="flex items-center gap-2"
              >
                <span class="text-sm text-muted whitespace-nowrap">Insert as:</span>
                <USelect
                  v-model="insertFormat"
                  :items="insertFormatItems"
                  class="flex-1"
                />
              </div>
              <div
                v-if="libraryItems.length"
                class="flex items-center gap-2"
              >
                <span class="text-sm text-muted whitespace-nowrap">Response library (optional):</span>
                <USelect
                  v-model="insertLibrary"
                  :items="libraryItems"
                  placeholder="Map option labels via a library"
                  class="flex-1"
                />
              </div>
              <div class="flex items-center gap-2">
                <code class="text-xs bg-elevated rounded px-2 py-1 flex-1 truncate">{{ pendingInsertPreview }}</code>
                <UButton
                  label="Insert"
                  icon="i-lucide-plus"
                  @click="insertPendingListField"
                />
                <UButton
                  label="Cancel"
                  color="neutral"
                  variant="ghost"
                  @click="cancelPendingListField"
                />
              </div>
            </div>
            <div
              v-if="pendingDeadline"
              class="space-y-2 rounded-lg border p-3"
            >
              <div class="flex items-center gap-2">
                <UInput
                  v-model.number="deadlineCount"
                  type="number"
                  :min="0"
                  class="w-20"
                />
                <USelect
                  v-model="deadlineUnit"
                  :items="deadlineUnitItems"
                  class="flex-1"
                />
              </div>
              <USelect
                v-model="deadlineSnap"
                :items="deadlineSnapItems"
                placeholder="Snap to weekday (optional)"
                class="w-full"
              />
              <div class="flex items-center gap-2">
                <code class="text-xs bg-elevated rounded px-2 py-1 flex-1 truncate">{{ deadlineToken }}</code>
                <UButton
                  label="Insert"
                  icon="i-lucide-plus"
                  @click="insertPendingDeadline"
                />
                <UButton
                  label="Cancel"
                  color="neutral"
                  variant="ghost"
                  @click="cancelPendingDeadline"
                />
              </div>
            </div>
          </div>
          <UEditor
            v-if="editorMode === 'visual'"
            ref="editorRef"
            v-slot="{ editor }"
            v-model="form.bodyHtml"
            content-type="html"
            placeholder="Write your message…"
            class="border rounded-lg min-h-64"
          >
            <div class="border-b px-2 py-1.5">
              <UEditorToolbar
                :editor="editor"
                :items="toolbarItems"
              />
            </div>
          </UEditor>
          <div
            v-else
            class="space-y-2"
          >
            <UTextarea
              ref="sourceTextareaRef"
              v-model="form.bodyHtml"
              :rows="16"
              autoresize
              class="w-full"
              :ui="{ base: 'font-mono text-xs' }"
              placeholder="<p>Hello {{First Name}},</p>"
            />
            <p class="text-xs text-muted">
              Tags or inline styles the visual editor doesn't support (e.g. tables, styled spans) are removed when switching back to Visual. Save while in HTML mode to keep custom markup.
            </p>
          </div>
        </UFormField>

        <div class="flex gap-2">
          <UButton
            :label="selectedId ? 'Save template' : 'Create template'"
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

        <UCard>
          <template #header>
            <h2 class="font-medium">
              Preview
            </h2>
          </template>
          <div class="flex gap-2 mb-4">
            <UInput
              v-model="previewSubmissionId"
              placeholder="Submission ID to render against"
              class="w-96"
            />
            <UButton
              label="Render preview"
              variant="outline"
              :loading="previewLoading"
              @click="renderPreview"
            />
            <UButton
              label="Send test message"
              icon="i-lucide-send"
              color="warning"
              variant="outline"
              :loading="sendLoading"
              @click="sendTest"
            />
          </div>
          <template v-if="preview">
            <UAlert
              v-if="preview.unresolved.length"
              color="warning"
              variant="subtle"
              :title="`Unresolved merge fields: ${preview.unresolved.join(', ')}`"
              class="mb-4"
            />
            <UAlert
              v-if="preview.unknownFormats?.length"
              color="warning"
              variant="subtle"
              :title="`Unknown formats (rendered as raw text): ${preview.unknownFormats.join(', ')}`"
              description="Supported formats are list, numbered, and comma."
              class="mb-4"
            />
            <UAlert
              v-if="preview.unknownLibraries?.length"
              color="warning"
              variant="subtle"
              :title="`Unknown response libraries: ${preview.unknownLibraries.join(', ')}`"
              description="Raw option labels were rendered for those tokens. Check the lib:key reference."
              class="mb-4"
            />
            <p class="text-sm font-medium mb-2">
              Subject: {{ preview.subject }}
            </p>
            <!-- eslint-disable vue/no-v-html -- template bodies are authored by admins -->
            <div
              class="prose max-w-none border rounded-lg p-3"
              v-html="preview.bodyHtml"
            />
            <!-- eslint-enable vue/no-v-html -->
          </template>
          <p
            v-else
            class="text-sm text-muted"
          >
            Enter a submission ID to render this template against real submission and review data. <strong>Send test message</strong> sends the rendered email to that submission's submitter via Submittable.
          </p>
        </UCard>
      </div>

      <aside class="md:col-span-2 xl:col-span-1">
        <UCard
          class="xl:sticky xl:top-4"
          :ui="{ body: 'space-y-5 text-sm' }"
        >
          <template #header>
            <h2 class="font-medium flex items-center gap-2">
              <UIcon name="i-lucide-lightbulb" />
              Formatting tips
            </h2>
          </template>

          <section>
            <h3 class="font-medium mb-2">
              Keyboard shortcuts
            </h3>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <template
                v-for="tip in shortcutTips"
                :key="tip.keys"
              >
                <dt><UKbd :value="tip.keys" /></dt>
                <dd class="text-muted">
                  {{ tip.effect }}
                </dd>
              </template>
            </dl>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Type-as-you-go shortcuts
            </h3>
            <p class="text-xs text-muted mb-2">
              Type these at the start of a line (or around text) in Visual mode.
            </p>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <template
                v-for="tip in markdownTips"
                :key="tip.keys"
              >
                <dt><code class="text-xs bg-elevated rounded px-1 py-0.5 whitespace-pre">{{ tip.keys }}</code></dt>
                <dd class="text-muted">
                  {{ tip.effect }}
                </dd>
              </template>
            </dl>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Links
            </h3>
            <p class="text-muted">
              Select text, then click the link button and paste the URL. Click the button again on a link to remove it.
            </p>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Merge fields
            </h3>
            <p class="text-muted">
              Pick a <strong>source</strong> (Submission or a review form, with its stage in parentheses), then a <strong>field</strong>. The token is inserted at the cursor in Visual or HTML mode.
            </p>
            <ul class="list-disc pl-5 text-muted mt-1 space-y-1">
              <li><code v-pre>{{First Name}}</code> — submission field</li>
              <li><code v-pre>{{Stage Name.Field}}</code> — field from the latest completed review in that stage</li>
            </ul>
            <p class="text-muted mt-1">
              Fields come from the active cycle's field mappings. You can also type tokens directly, including in the subject. Unresolved fields are flagged in Preview.
            </p>
            <p class="text-muted mt-1">
              The <strong>Computed</strong> source provides built-in tokens:
            </p>
            <ul class="list-disc pl-5 text-muted mt-1 space-y-1">
              <li><code v-pre>{{links.submission}}</code> — applicant link to the submission</li>
              <li><code v-pre>{{links.submissionForms}}</code> — same link, straight to the Forms tab</li>
              <li><code v-pre>{{deadline | 2 weeks}}</code> — date offset from send time</li>
            </ul>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Deadlines
            </h3>
            <p class="text-muted">
              <code v-pre>{{deadline | N calendar|business days|weeks}}</code> renders the date (e.g. "Friday, January 16, 2026") N calendar days, business days, or weeks after send time. Add <code v-pre>| snap friday</code> (any weekday) to push the date to the next occurrence of that weekday.
            </p>
            <ul class="list-disc pl-5 text-muted mt-1 space-y-1">
              <li><code v-pre>{{deadline | 10 business days}}</code></li>
              <li><code v-pre>{{deadline | 2 weeks | snap friday}}</code></li>
            </ul>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Response libraries
            </h3>
            <p class="text-muted">
              After choosing a field, pick a <ULink
                to="/response-libraries"
                class="underline"
              >response library</ULink> in the insert panel to map each selected option to alternate text — no need to type <code v-pre>| lib:key</code> yourself (e.g. <code v-pre>{{Stage.Field | list | lib:gpa-issues}}</code>). Options without a matching entry are omitted.
            </p>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Multi-select fields as lists
            </h3>
            <p class="text-muted">
              Fields marked <UBadge
                label="multi-select"
                size="sm"
                variant="subtle"
                color="info"
              /> can be formatted by adding a format after a pipe:
            </p>
            <ul class="list-disc pl-5 text-muted mt-1 space-y-1">
              <li><code v-pre>{{Stage.Field | list}}</code> — bulleted list</li>
              <li><code v-pre>{{Stage.Field | numbered}}</code> — numbered list</li>
              <li><code v-pre>{{Stage.Field | comma}}</code> — “A, B and C”</li>
            </ul>
            <p class="text-muted mt-1">
              Lists render only when the token is on its own line; inside a sentence (or in the subject) they fall back to comma style. If nothing was selected, the line is removed.
            </p>
          </section>

          <section>
            <h3 class="font-medium mb-1">
              Email best practices
            </h3>
            <ul class="list-disc pl-5 text-muted space-y-1">
              <li>Keep formatting simple — email clients render inconsistently.</li>
              <li>Prefer links over images or attachments.</li>
              <li>Use HTML mode to inspect or fine-tune markup.</li>
              <li>Always run <strong>Render preview</strong> against a real submission before using a template in routing.</li>
            </ul>
          </section>
        </UCard>
      </aside>
    </div>
  </UContainer>
</template>
