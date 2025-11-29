<script setup>
import { ref } from 'vue'

const props = defineProps({
  fileBlob: [File, Object]
})

const emit = defineEmits(['fileChange'])
const fileInput = ref(null)

function onFileChange(e) {
  const f = e.target.files?.[0]
  emit('fileChange', f || null)
}

function triggerUpload() {
  fileInput.value?.click()
}
</script>

<template>
  <div class="upload-zone" @click="triggerUpload"
    :class="{ 'has-file': !!fileBlob }">
    <input ref="fileInput" type="file" accept=".pdf,.epub" @change="onFileChange" style="display:none" />
    <div v-if="!fileBlob" style="text-align:center">
      <svg class="icon" style="width:32px;height:32px;color:var(--accent);margin-bottom:8px" viewBox="0 0 24 24"
        fill="none" stroke="currentColor">
        <path d="M12 12v6m0-6V6m0 6H6m6 0h6" />
      </svg>
      <div style="font-weight:600">Click to upload book</div>
      <div class="muted" style="font-size:12px">.pdf or .epub</div>
    </div>
    <div v-else style="display:flex;align-items:center;gap:12px;width:100%">
      <div style="background:var(--surface-alt);padding:8px;border-radius:8px">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6" />
          <path d="M16 13H8" />
          <path d="M16 17H8" />
          <path d="M10 9H8" />
        </svg>
      </div>
      <div style="flex:1;overflow:hidden">
        <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">{{ fileBlob.name }}
        </div>
        <div class="muted" style="font-size:12px">{{ (fileBlob.size/1048576).toFixed(2) }} MB</div>
      </div>
      <button class="btn ghost" style="padding:4px"
        @click.stop="triggerUpload">Change</button>
    </div>
  </div>
</template>
