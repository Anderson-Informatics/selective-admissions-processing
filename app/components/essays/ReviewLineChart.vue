<script setup lang="ts">
const props = defineProps<{
  data: { time: string, count: number }[]
}>()

const width = 800
const height = 260
const pad = { top: 16, right: 16, bottom: 40, left: 40 }
const plotWidth = width - pad.left - pad.right
const plotHeight = height - pad.top - pad.bottom

const maxCount = computed(() => Math.max(1, ...props.data.map(point => point.count)))
const yTicks = computed(() => {
  const step = Math.max(1, Math.ceil(maxCount.value / 5))
  const top = Math.ceil(maxCount.value / step) * step
  return Array.from({ length: Math.floor(top / step) + 1 }, (_, index) => index * step)
})
const yMax = computed(() => yTicks.value[yTicks.value.length - 1] || 1)

function x(index: number) {
  return pad.left + (props.data.length > 1 ? (index / (props.data.length - 1)) * plotWidth : plotWidth / 2)
}

function y(value: number) {
  return pad.top + plotHeight - (value / yMax.value) * plotHeight
}

const points = computed(() => props.data.map((point, index) => ({ ...point, cx: x(index), cy: y(point.count) })))
const linePath = computed(() => points.value.map((point, index) => `${index ? 'L' : 'M'}${point.cx},${point.cy}`).join(' '))
const labelEvery = computed(() => Math.max(1, Math.ceil(props.data.length / 12)))
</script>

<template>
  <svg
    :viewBox="`0 0 ${width} ${height}`"
    class="w-full h-auto text-muted"
    role="img"
    aria-label="Reviews completed per 15 minutes"
  >
    <g
      v-for="tick in yTicks"
      :key="`y-${tick}`"
    >
      <line
        :x1="pad.left"
        :x2="width - pad.right"
        :y1="y(tick)"
        :y2="y(tick)"
        stroke="currentColor"
        stroke-opacity="0.15"
      />
      <text
        :x="pad.left - 8"
        :y="y(tick)"
        text-anchor="end"
        dominant-baseline="middle"
        font-size="11"
        fill="currentColor"
      >{{ tick }}</text>
    </g>

    <template
      v-for="(point, index) in points"
      :key="`x-${point.time}`"
    >
      <text
        v-if="index % labelEvery === 0 || index === points.length - 1"
        :x="point.cx"
        :y="height - pad.bottom + 18"
        text-anchor="middle"
        font-size="11"
        fill="currentColor"
      >{{ point.time }}</text>
    </template>

    <path
      :d="linePath"
      fill="none"
      stroke="var(--ui-primary)"
      stroke-width="2.5"
      stroke-linejoin="round"
      stroke-linecap="round"
    />
    <circle
      v-for="point in points"
      :key="`p-${point.time}`"
      :cx="point.cx"
      :cy="point.cy"
      r="4"
      fill="var(--ui-primary)"
    >
      <title>{{ point.time }} — {{ point.count }} review{{ point.count === 1 ? '' : 's' }}</title>
    </circle>

    <text
      :x="pad.left + plotWidth / 2"
      :y="height - 4"
      text-anchor="middle"
      font-size="11"
      fill="currentColor"
    >Time (Detroit)</text>
  </svg>
</template>
