<script setup lang="ts">
import { formatDate, formatDateOnly, formatOptInEnrollment, gpaStatusColor, reviewIssues, shortSchoolName, sourceLabel, type GpaReviewItem } from '~/utils/gpaReview'

const props = defineProps<{
  record: GpaReviewItem
}>()

interface DetailField {
  label: string
  value: string | number
  title?: string
}

interface SourceSection {
  key: string
  title: string
  empty: boolean
  isResolvedSource: boolean
  fields: DetailField[]
}

const issues = computed(() => reviewIssues(props.record))

const sections = computed<SourceSection[]>(() => {
  const record = props.record
  const dpscd = record.gpa?.dpscd
  const optIn = record.gpa?.optIn
  const recording = record.recordingReview
  const partial = record.partialReview

  return [
    {
      key: 'recording',
      title: 'GPA Recording review',
      empty: !recording,
      isResolvedSource: record.resolvedSource === 'recording',
      fields: [
        { label: 'GPA', value: String(recording?.mappedData?.CumulativeGPA ?? '—') },
        { label: 'Able to record', value: String(recording?.mappedData?.AbleToRecord || '—') },
        { label: 'Status', value: recording?.status || '—' },
        { label: 'Completed', value: formatDate(recording?.completedAt) }
      ]
    },
    {
      key: 'partial',
      title: 'Partial GPA review',
      empty: !partial,
      isResolvedSource: record.resolvedSource === 'partial',
      fields: [
        { label: 'GPA', value: String(partial?.mappedData?.PartialGPA ?? '—') },
        { label: 'Semesters', value: String(partial?.mappedData?.Semesters || '—') },
        { label: 'Status', value: partial?.status || '—' },
        { label: 'Completed', value: formatDate(partial?.completedAt) }
      ]
    },
    {
      key: 'dpscd',
      title: 'DPSCD / PowerSchool',
      empty: !dpscd,
      isResolvedSource: record.resolvedSource === 'dpscd',
      fields: [
        { label: 'Student number', value: dpscd?.studentNumber ?? '—' },
        { label: 'Name in import', value: dpscd?.studentName || '—' },
        { label: 'DOB', value: formatDateOnly(dpscd?.dob) },
        { label: 'Current school', value: dpscd ? `${shortSchoolName(dpscd.schoolName)}${dpscd.schoolNumber != null ? ` (${dpscd.schoolNumber})` : ''}` : '—', title: dpscd?.schoolName },
        { label: 'Grade level', value: dpscd?.gradeLevel ?? '—' },
        { label: 'Enrollment dates', value: `${formatDateOnly(dpscd?.minimumEntryDate)} – ${formatDateOnly(dpscd?.latestExitDate)}` },
        { label: 'GPA', value: dpscd?.cumulativeGpa ?? '—' },
        { label: 'Quarters', value: dpscd?.quartersAvailable ?? '—' },
        { label: 'Round', value: dpscd?.selectedRound || '—' },
        { label: 'Issue', value: dpscd?.selectionIssue || '—' },
        { label: 'Imported', value: formatDate(dpscd?.importedAt) }
      ]
    },
    {
      key: 'optIn',
      title: 'Opt-In upload',
      empty: !optIn,
      isResolvedSource: record.resolvedSource === 'optIn',
      fields: [
        { label: 'Name in file', value: optIn?.studentName || '—' },
        { label: 'School', value: shortSchoolName(optIn?.schoolName), title: optIn?.schoolName },
        { label: 'GPA', value: optIn?.cumulativeGpa ?? '—' },
        { label: 'Minimum enrollment met', value: formatOptInEnrollment(record) },
        { label: 'Source file', value: optIn?.sourceFile || '—' },
        { label: 'Opt-In label', value: optIn ? (record.hasOptInLabel ? 'Present' : 'Missing') : '—' },
        { label: 'Imported', value: formatDate(optIn?.importedAt) }
      ]
    }
  ]
})

interface SnapshotRow {
  key: string
  label: string
  cumulativeGpa?: number
  quartersAvailable?: number
  gpaStatus?: string
  selected: boolean
}

const dpscdSnapshotRows = computed<SnapshotRow[]>(() => {
  const dpscd = props.record.gpa?.dpscd
  if (!dpscd?.snapshots) return []
  return (['r1', 'all'] as const)
    .filter(key => dpscd.snapshots?.[key])
    .map(key => ({
      key,
      label: key === 'r1' ? 'Round 1' : 'All available',
      cumulativeGpa: dpscd.snapshots?.[key]?.cumulativeGpa,
      quartersAvailable: dpscd.snapshots?.[key]?.quartersAvailable,
      gpaStatus: dpscd.snapshots?.[key]?.gpaStatus,
      selected: dpscd.selectedSnapshot === key
    }))
})

const scoreFormula = computed(() => {
  const gpa = props.record.gpa
  if (!gpa || gpa.gpaScore == null) return ''
  return `GPA ${props.record.resolvedCumulativeGpa ?? '—'} × ${gpa.gpaMultiplier ?? '—'} + ${gpa.gpaBonus ?? '—'} bonus`
})
</script>

<template>
  <div class="bg-elevated/50 p-4 space-y-4 text-sm">
    <!-- Resolved scoring summary -->
    <div class="rounded-lg border border-default bg-default p-4 flex flex-wrap items-baseline gap-x-8 gap-y-2">
      <div class="flex items-baseline gap-2">
        <span class="text-muted">Resolved GPA</span>
        <span class="text-2xl font-semibold">{{ record.resolvedCumulativeGpa ?? '—' }}</span>
      </div>
      <UBadge
        :label="sourceLabel(record.resolvedSource)"
        color="primary"
        variant="subtle"
      />
      <UBadge
        :label="record.gpaStatus || 'Incomplete'"
        :color="gpaStatusColor(record.gpaStatus)"
        variant="subtle"
      />
      <span
        v-if="scoreFormula"
        class="text-muted"
      >
        {{ scoreFormula }} = <strong class="text-default">{{ record.gpa?.gpaScore }}</strong>
      </span>
      <span
        v-else
        class="text-muted italic"
      >
        Not yet scored
      </span>
      <span class="text-xs text-muted ml-auto">
        Bonus eligible: {{ record.gpa?.gpaBonusEligible == null ? '—' : record.gpa.gpaBonusEligible ? 'Yes' : 'No' }}
        · Updated {{ formatDate(record.gpa?.updatedAt || record.updatedAtTimestamp) }}
      </span>
    </div>

    <UAlert
      v-if="issues.length"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      title="Review issues"
      :description="issues.join('; ')"
    />

    <!-- Source evidence -->
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <div
        v-for="section in sections"
        :key="section.key"
        :class="['rounded-lg border border-default bg-default p-3', { 'ring-1 ring-primary': section.isResolvedSource, 'opacity-60': section.empty }]"
      >
        <div class="flex items-center justify-between gap-2 mb-2">
          <h3 class="text-xs font-semibold uppercase tracking-wide text-muted">
            {{ section.title }}
          </h3>
          <UBadge
            v-if="section.isResolvedSource"
            label="Used for score"
            color="primary"
            variant="subtle"
            size="sm"
          />
        </div>
        <p
          v-if="section.empty"
          class="text-muted italic"
        >
          Not recorded
        </p>
        <template v-else>
          <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <template
              v-for="field in section.fields"
              :key="field.label"
            >
              <dt class="text-muted">
                {{ field.label }}
              </dt>
              <dd
                class="min-w-0"
                :title="field.title"
              >
                {{ field.value }}
              </dd>
            </template>
          </dl>
          <table
            v-if="section.key === 'dpscd' && dpscdSnapshotRows.length"
            class="w-full text-xs mt-3 border-t border-default pt-2"
          >
            <thead>
              <tr class="text-muted text-left">
                <th class="font-medium pr-2 pt-2">
                  Snapshot
                </th>
                <th class="font-medium pr-2 pt-2">
                  GPA
                </th>
                <th class="font-medium pr-2 pt-2">
                  Quarters
                </th>
                <th class="font-medium pt-2">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="snapshot in dpscdSnapshotRows"
                :key="snapshot.key"
                :class="{ 'font-medium': snapshot.selected }"
              >
                <td class="pr-2 pt-1">
                  {{ snapshot.label }}<span
                    v-if="snapshot.selected"
                    class="text-primary"
                  > · selected</span>
                </td>
                <td class="pr-2 pt-1">
                  {{ snapshot.cumulativeGpa ?? '—' }}
                </td>
                <td class="pr-2 pt-1">
                  {{ snapshot.quartersAvailable ?? '—' }}
                </td>
                <td class="pt-1">
                  {{ snapshot.gpaStatus || '—' }}
                </td>
              </tr>
            </tbody>
          </table>
        </template>
      </div>
    </div>
  </div>
</template>
