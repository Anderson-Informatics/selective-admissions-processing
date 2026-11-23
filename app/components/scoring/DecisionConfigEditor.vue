<script setup lang="ts">
import { DEFAULT_PREFERENCE_FIELDS, type DecisionConfig } from '../../../server/utils/decisionConfig'

const props = defineProps<{ applicationId: string }>()
const model = defineModel<DecisionConfig | null>({ required: true })
interface References { schools: { id: string, name: string, active: boolean }[], authorities: { schoolId: string, userId: string, name: string, applicationId: string, version: number, valid: boolean }[], stages: { stageId: string, name: string, fields: string[] }[] }
const { data: references } = await useFetch<References>(`/api/applications/${props.applicationId}/decision-references`)
const errors = ref<Record<string, string>>({})
function setValues(index: number, outcome: 'accept' | 'decline' | 'waitlist', text: string) {
  const source = model.value?.sources[index]
  if (!source) return
  const entries = text.split('\n').map(value => value.trim()).filter(Boolean)
  const errorKey = `${index}:${outcome}`
  if (source.kind === 'score' && entries.some(value => !Number.isFinite(Number(value)))) {
    errors.value[errorKey] = 'Score mappings must be numeric'
    source[outcome] = entries
    return
  }
  errors.value = Object.fromEntries(Object.entries(errors.value).filter(([key]) => key !== errorKey))
  source[outcome] = source.kind === 'score' ? entries.map(Number) : entries
}
</script>

<template>
  <section class="space-y-4 border-t pt-4">
    <h3 class="font-medium">
      Decision-based proposed placement
    </h3>
    <p class="text-sm text-muted">
      Supporting scores do not rank placements. The highest-ranked school accepting through its primary reviewer is proposed. All waitlists remain visible. No placements are finalized here.
    </p>
    <UButton
      v-if="!model"
      label="Configure decisions"
      @click="model = { preferenceFields: [...DEFAULT_PREFERENCE_FIELDS], schoolIds: [], sources: [] }"
    />
    <template v-else>
      <UFormField label="Participating schools">
        <USelectMenu
          v-model="model.schoolIds"
          multiple
          value-key="value"
          :items="(references?.schools || []).map(school => ({ label: `${school.name}${school.active ? '' : ' (inactive)'}`, value: school.id }))"
          class="w-full"
        />
      </UFormField>
      <UFormField label="Preference fields, in ranked order (comma separated)">
        <UInput
          :model-value="model.preferenceFields.join(', ')"
          class="w-full"
          @update:model-value="model.preferenceFields = String($event).split(',').map(value => value.trim()).filter(Boolean)"
        />
      </UFormField>
      <ul class="text-sm space-y-1">
        <li
          v-for="schoolId in model.schoolIds"
          :key="schoolId"
        >
          {{ references?.schools.find(school => school.id === schoolId)?.name || schoolId }}: {{ references?.authorities.find(authority => authority.schoolId === schoolId && authority.valid)?.name || 'Missing or inactive primary reviewer — configure in User Management' }}<span v-if="references?.authorities.find(authority => authority.schoolId === schoolId)?.applicationId"> (application override)</span>
        </li>
      </ul>
      <div
        v-for="(source, index) in model.sources"
        :key="index"
        class="border rounded p-3 space-y-3"
      >
        <div class="flex gap-3 flex-wrap">
          <UFormField label="Decision stage">
            <USelect
              v-model="source.stageId"
              :items="(references?.stages || []).map(stage => ({ label: stage.name, value: stage.stageId }))"
              value-key="value"
            />
          </UFormField>
          <UFormField label="Decision source">
            <USelect
              v-model="source.kind"
              :items="[{ label: 'Mapped review field', value: 'field' }, { label: 'Review score', value: 'score' }]"
              value-key="value"
              @update:model-value="source.accept = []; source.decline = []; source.waitlist = []"
            />
          </UFormField>
          <UFormField
            v-if="source.kind === 'field'"
            label="Mapped field"
          >
            <USelect
              v-model="source.field"
              :items="references?.stages.find(stage => stage.stageId === source.stageId)?.fields || []"
            />
          </UFormField>
          <UButton
            label="Remove source"
            color="neutral"
            variant="ghost"
            @click="model.sources.splice(index, 1)"
          />
        </div>
        <div class="grid sm:grid-cols-3 gap-3">
          <UFormField
            v-for="outcome in (['accept', 'decline', 'waitlist'] as const)"
            :key="outcome"
            :label="`${outcome} values (one per line)`"
            :error="errors[`${index}:${outcome}`]"
          >
            <UTextarea
              :model-value="source[outcome].join('\n')"
              class="w-full"
              @update:model-value="setValues(index, outcome, String($event))"
            />
          </UFormField>
        </div>
      </div>
      <UButton
        label="Add decision source"
        variant="outline"
        @click="model.sources.push({ stageId: '', kind: 'field', field: '', accept: [], decline: [], waitlist: [] })"
      />
      <p class="text-sm text-muted">
        Changes are saved with application settings. Missing or invalid mappings produce diagnostics, never inferred decisions. Preview again after configuration changes.
      </p>
    </template>
  </section>
</template>
