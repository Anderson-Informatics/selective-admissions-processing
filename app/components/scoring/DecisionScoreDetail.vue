<script setup lang="ts">
import type { DecisionResult } from '../../../server/utils/decisionScoring'
import type { ScoreRecord } from '../../../server/models/ScoreRecord'

defineProps<{ decision: DecisionResult, routing?: ScoreRecord['routingEvaluation'], fingerprint?: string | null, compiledAt?: string }>()
</script>

<template>
  <details class="text-sm min-w-72">
    <summary class="cursor-pointer">
      {{ decision.proposed ? `Proposed: ${decision.proposed.schoolName} (choice ${decision.proposed.rank})` : 'No definitive proposal' }}
      <span
        v-if="decision.needsAttention"
        class="text-warning"
      > — Review warnings</span>
    </summary>
    <p class="text-muted my-2">
      Preview/snapshot only, not final placement. Recompile after decisions or configuration change.
      <span v-if="compiledAt">Generated: {{ compiledAt }}</span>
    </p>
    <p v-if="!decision.proposed && decision.candidate">
      Known acceptance candidate: {{ decision.candidate.schoolName }} — resolve warnings before proposing.
    </p>
    <div
      v-for="school in decision.schools"
      :key="school.schoolId"
      class="border-t py-2 space-y-1"
    >
      <p class="font-medium">
        {{ school.rank ? `Choice ${school.rank}: ` : 'Unranked: ' }}{{ school.schoolName }} — {{ school.outcome }}
      </p>
      <p>Primary reviewer: {{ school.primaryUserId || 'Not configured' }}</p>
      <ul class="pl-4 list-disc">
        <li
          v-for="item in school.evidence"
          :key="item.entryId"
        >
          {{ item.outcome }} ({{ String(item.value ?? 'blank') }}) · {{ item.reviewerId || 'Unknown reviewer' }} · {{ item.completedAt || item.createdAt || 'No timestamp' }} · {{ school.controllingEntryIds.includes(item.entryId) ? 'controlling' : item.authoritative ? 'superseded' : 'non-authoritative' }} · entry {{ item.entryId }} · stage {{ item.stageId }}
        </li>
      </ul>
    </div>
    <div
      v-if="decision.unattributedEvidence?.length"
      class="border-t py-2"
    >
      <p class="font-medium">
        Unattributed reviews — not used for any school decision
      </p>
      <ul class="list-disc pl-4">
        <li
          v-for="item in decision.unattributedEvidence"
          :key="item.entryId"
        >
          {{ item.reviewerId || 'Missing reviewer ID' }} · {{ String(item.value ?? 'blank') }} · entry {{ item.entryId }} · stage {{ item.stageId }} · {{ item.completedAt || item.createdAt || 'No timestamp' }}
        </li>
      </ul>
    </div>
    <ul class="text-warning list-disc pl-4">
      <li
        v-for="warning in decision.diagnostics"
        :key="warning"
      >
        {{ warning }}
      </li>
    </ul>
    <div
      v-if="routing"
      class="border-t py-2"
    >
      <p class="font-medium">
        Published routing (separate from proposed placement)
      </p>
      <p>{{ routing.recommendation.action }} · {{ routing.recommendation.reason }}<span v-if="routing.recommendation.toStageId"> · target {{ routing.recommendation.toStageId }}</span></p>
      <ul>
        <li
          v-for="entry in routing.completion"
          :key="entry.stageId"
        >
          {{ entry.name }}: {{ entry.status }} · {{ entry.required ? 'required' : 'optional' }} · {{ entry.complete ? 'complete' : 'incomplete' }}
        </li>
      </ul>
    </div>
    <p
      v-if="fingerprint"
      class="text-muted break-all"
    >
      Configuration: {{ fingerprint }}
    </p>
  </details>
</template>
