<script setup>
const props = defineProps({
  trace: Array,
  isOpen: Boolean
})

const emit = defineEmits(['close', 'download'])

function stringify(obj) {
  try {
    return JSON.stringify(obj, null, 2)
  } catch {
    return String(obj)
  }
}
</script>

<template>
  <div id="trace" class="trace" :class="{ open: isOpen }" :aria-hidden="!isOpen">
    <div class="head">
      <div style="font-weight:700">Trace</div>
      <div class="grow"></div>
      <button class="btn" @click="$emit('close')">Close</button>
      <button class="btn" @click="$emit('download')">Download trace.json</button>
    </div>
    <div id="traceList" class="list">
      <div class="item" v-for="t in trace.slice().reverse()" :key="t.ts">
        <div><b>{{ t.error ? 'Error' : 'Turn' }}</b> <span class="muted" style="float:right">{{ new
            Date(t.ts).toLocaleTimeString() }}</span></div>
        <div class="muted">Request:</div>
        <div class="pre">{{ stringify(t.request) }}</div>
        <template v-if="t.response">
          <div class="muted">Response:</div>
          <div class="pre">{{ stringify(t.response) }}</div>
        </template>
        <template v-if="t.error">
          <div class="muted">Error:</div>
          <div class="pre">{{ stringify(t.error) }}</div>
        </template>
        <div class="muted" v-if="t.retries>0">Retries: {{ t.retries }}</div>
      </div>
    </div>
  </div>
</template>
