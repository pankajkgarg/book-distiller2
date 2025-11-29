<script setup>
import { marked } from 'marked'

const props = defineProps({
  sectionsMeta: Array
})

const emit = defineEmits(['deleteSection'])

function renderMd(md) {
  try {
    return marked.parse(md || '')
  } catch {
    return md || ''
  }
}

function getTitleFromMd(md) {
  const lines = (md || '').split(/\r?\n/)
  for (const line of lines) {
    const m = line.match(/^\s{0,3}#{1,6}\s+(.+)/)
    if (m) return m[1].trim()
    if (line.trim()) return line.trim().slice(0, 96)
  }
  return 'Untitled Section'
}
</script>

<template>
  <div class="card" style="display:flex;flex-direction:column">
    <div class="head">Live Document</div>
    <div class="doc" id="liveDoc">
      <div v-if="sectionsMeta.length===0" class="muted">Output will appear here…</div>
      <div v-else>
        <div class="section" v-for="(meta, i) in sectionsMeta" :key="meta.id" :data-sid="String(meta.id)">
          <div class="sectionHead">
            <div class="sectionTitle">
              Section {{ i+1 }}: {{ getTitleFromMd(meta.text) }}
              <span v-if="Number.isFinite(Number(meta?.candidatesTokenCount))" class="muted"
                style="margin-left:8px">tokens: {{ Number(meta.candidatesTokenCount) }}</span>
            </div>
            <button class="btn ghost" @click="$emit('deleteSection', meta.id)">Delete</button>
          </div>
          <div class="sectionBody">
            <div class="prose" v-html="renderMd(meta.text)"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
