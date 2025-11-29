<script setup>
import { ref, watch, nextTick } from 'vue'

const props = defineProps({
  apiKey: String,
  savedKeys: Array,
  model: String,
  useTemperature: Boolean,
  temperature: Number,
  pauseOnAnomaly: Boolean,
  autoWaitBetweenRequests: Boolean,
  endMarker: String,
  budgetTokens: [Number, String],
  isSettingsOpen: Boolean
})

const emit = defineEmits([
  'update:apiKey', 'update:model', 'update:useTemperature', 'update:temperature',
  'update:pauseOnAnomaly', 'update:autoWaitBetweenRequests', 'update:endMarker',
  'update:budgetTokens', 'update:isSettingsOpen',
  'saveKey', 'deleteKey', 'loadKey', 'clearKey'
])

const localApiKey = ref(props.apiKey)
const isSavingKey = ref(false)
const newKeyLabel = ref('')
const labelInput = ref(null)

watch(() => props.apiKey, (newVal) => {
  localApiKey.value = newVal
})

watch(localApiKey, (newVal) => {
  emit('update:apiKey', newVal)
})

watch(isSavingKey, (val) => {
  if (val) {
    newKeyLabel.value = ''
    nextTick(() => labelInput.value?.focus())
  }
})

function confirmSaveKey() {
  if (!newKeyLabel.value.trim()) newKeyLabel.value = 'Default'
  emit('saveKey', newKeyLabel.value)
  isSavingKey.value = false
}
</script>

<template>
  <div class="card">
    <div class="head">Source & Settings</div>
    <div class="body">
      <slot name="upload-zone"></slot>

      <label>Distillation Prompt</label>
      <slot name="prompt-area"></slot>

      <!-- Settings Toggle -->
      <details class="settings-details" :open="isSettingsOpen" @toggle="$emit('update:isSettingsOpen', $event.target.open)">
        <summary>
          <span>Settings & API Key</span>
          <svg class="icon chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </summary>

        <div style="padding-top:12px">
          <label style="margin-top:0">Gemini API Key</label>

          <!-- Saved Keys Dropdown -->
          <div v-if="savedKeys.length > 0" style="margin-bottom:8px">
            <select @change="$emit('loadKey', savedKeys[$event.target.value])" style="font-size:13px">
              <option disabled selected>Select a saved key...</option>
              <option v-for="(k, i) in savedKeys" :key="i" :value="i">
                {{ k.label }} ({{ k.key.slice(0,4) }}...{{ k.key.slice(-4) }})
              </option>
            </select>
          </div>

          <div class="row">
            <input v-model="localApiKey" type="password" placeholder="••••••••••••••••••••••" />
            <button class="btn" @click="isSavingKey = true">Save</button>
            <button class="btn ghost" @click="$emit('clearKey')">Clear</button>
          </div>

          <!-- Save Key Dialog -->
          <div v-if="isSavingKey" style="margin-top:8px;padding:8px;border:1px solid var(--line);border-radius:8px;background:var(--surface-alt)">
            <div style="font-size:13px;font-weight:600;margin-bottom:6px">Save API Key</div>
            <input v-model="newKeyLabel" placeholder="Label (e.g. Personal)" style="margin-bottom:6px;width:100%" @keyup.enter="confirmSaveKey" ref="labelInput">
            <div class="row">
              <button class="btn primary sm" @click="confirmSaveKey">Save</button>
              <button class="btn sm" @click="isSavingKey = false">Cancel</button>
            </div>
          </div>

          <!-- Key List (Mini Manager) -->
          <div v-if="savedKeys.length > 0"
            style="margin-top:8px;border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--surface-alt)">
            <div style="font-size:12px;font-weight:600;margin-bottom:4px">Saved Keys</div>
            <div v-for="(k, i) in savedKeys" :key="i"
              style="display:flex;align-items:center;justify-content:space-between;font-size:12px;margin-bottom:4px">
              <span>{{ k.label }}</span>
              <button class="btn ghost" style="padding:2px 6px;height:auto;font-size:11px"
                @click="$emit('deleteKey', i)">Delete</button>
            </div>
          </div>

          <div class="muted" style="font-size:12px;margin-top:4px">Stored locally in your browser.</div>

          <label>Model</label>
          <select :value="model" @change="$emit('update:model', $event.target.value)">
            <option value="gemini-2.5-pro">gemini-2.5-pro</option>
            <option value="gemini-2.5-flash">gemini-2.5-flash</option>
            <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
          </select>

          <div style="margin-top:16px;border-top:1px solid var(--line);padding-top:12px">
            <div style="font-weight:600;font-size:13px;margin-bottom:8px">Advanced</div>
            <div class="row" style="flex-wrap:wrap">
              <label class="row" style="margin:0;font-weight:400">
                <input type="checkbox" :checked="useTemperature" @change="$emit('update:useTemperature', $event.target.checked)">
                Temperature
              </label>
              <input :disabled="!useTemperature" :value="temperature" @input="$emit('update:temperature', +$event.target.value)" type="number" min="0" max="2" step="0.1"
                style="width:80px">
            </div>
            <label class="row" style="margin:8px 0 0;font-weight:400">
              <input type="checkbox" :checked="pauseOnAnomaly" @change="$emit('update:pauseOnAnomaly', $event.target.checked)">
              Pause on anomaly
            </label>
            <label class="row" style="margin:4px 0 0;font-weight:400">
              <input type="checkbox" :checked="autoWaitBetweenRequests" @change="$emit('update:autoWaitBetweenRequests', $event.target.checked)">
              Auto wait 60s
            </label>

            <div class="row" style="margin-top:8px">
              <div style="flex:1">
                <div class="muted" style="font-size:12px">End marker</div>
                <input :value="endMarker" @input="$emit('update:endMarker', $event.target.value)" style="font-size:12px">
              </div>
              <div style="flex:1">
                <div class="muted" style="font-size:12px">Budget (tokens)</div>
                <input :value="budgetTokens" @input="$emit('update:budgetTokens', $event.target.value)" type="number" style="font-size:12px">
              </div>
            </div>
          </div>
        </div>
      </details>
    </div>
  </div>
</template>
