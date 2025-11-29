<script setup>
import { computed } from 'vue'

const props = defineProps({
  running: Boolean,
  paused: Boolean,
  status: String,
  sections: Number,
  tokenTally: Number,
  lastErrorMessage: String,
  retrying: Boolean,
  retryAttempt: Number,
  retryMax: [Number, String],
  retryRemainingMs: Number,
  retryPlannedMs: Number,
  autoWaiting: Boolean,
  autoWaitRemainingMs: Number,
  autoWaitPlannedMs: Number,
  themeMode: String,
  hasModelHistory: Boolean
})

const emit = defineEmits([
  'start', 'stop', 'togglePause', 'resume', 
  'openExport', 'toggleTrace', 'toggleTheme', 'openInfo'
])

const statusClass = computed(() => ({
  running: props.running && !props.paused,
  good: props.status === 'complete',
  warn: props.paused || /paused/i.test(props.status),
  bad: /error/i.test(props.status)
}))
</script>

<template>
  <div class="topbar">
    <div class="container">
      <div class="row" style="padding:12px 0">
        <div style="font-weight:700;font-size:16px;margin-right:12px">DistillBoard</div>

        <button class="btn primary" :disabled="running" @click="$emit('start')">
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.5 5.653c0-1.262 1.36-2.037 2.454-1.35l10.5 6.347a1.5 1.5 0 010 2.6l-10.5 6.347A1.5 1.5 0 014.5 18.647V5.653z" />
          </svg>
          Start
        </button>

        <button class="btn" :disabled="!running" @click="$emit('togglePause')">
          <svg v-if="!paused" class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6.75 5.25h3v13.5h-3zM14.25 5.25h3v13.5h-3z" />
          </svg>
          <svg v-else class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M4.5 5.653c0-1.262 1.36-2.037 2.454-1.35l10.5 6.347a1.5 1.5 0 010 2.6l-10.5 6.347A1.5 1.5 0 014.5 18.647V5.653z" />
          </svg>
          {{ paused ? 'Resume' : 'Pause' }}
        </button>

        <button class="btn" :disabled="!running" @click="$emit('stop')">
          <svg class="icon" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 6h12v12H6z" />
          </svg>
          Stop
        </button>

        <div class="grow"></div>

        <button class="btn" :disabled="running || !hasModelHistory" @click="$emit('openExport')" title="Export">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M3 16.5v2.25A1.5 1.5 0 004.5 20.25h15A1.5 1.5 0 0021 18.75V16.5" />
            <path d="M12 3v12m0 0l4.5-4.5M12 15l-4.5-4.5" />
          </svg>
          <span class="hide-mobile">Export</span>
        </button>

        <button class="btn ghost" @click="$emit('toggleTrace')" title="Trace">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M4 6h16M4 12h10M4 18h7" />
          </svg>
        </button>

        <button class="btn ghost" @click="$emit('toggleTheme')" title="Toggle Theme">
          <svg v-if="themeMode==='dark'" class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
          </svg>
          <svg v-else class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="5" />
            <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
        </button>

        <button class="btn ghost" @click="$emit('openInfo')" title="Info">
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8h.01M11 11h2v5h-2z" />
          </svg>
        </button>
      </div>
      
      <div class="row" style="padding:0 0 10px 0;font-size:13px">
        <div class="status" style="display:flex;align-items:center;gap:6px">
          <span class="status-badge" :class="statusClass">
            <span v-if="running && !paused" class="spinner sm" aria-hidden="true"></span>
            <span aria-live="polite">{{ status }}</span>
          </span>
        </div>
        <div class="status">• sections: <span>{{ sections }}</span></div>
        <div class="status">• tokens: <span>{{ tokenTally }}</span></div>
        <div class="grow"></div>
        
        <div class="status" v-if="paused">
          <span v-if="lastErrorMessage" class="pill bad" :title="lastErrorMessage">
            Error: {{ (lastErrorMessage||'').slice(0,80) }}
          </span>
          <button class="btn" style="margin-left:8px" @click="$emit('resume')">Resume</button>
        </div>

        <div class="status" v-if="retrying" style="display:flex;align-items:center;gap:8px">
          <span class="pill" :title="lastErrorMessage || 'Temporary issue'">
            <span class="spinner"></span> Retrying in {{ Math.ceil(retryRemainingMs/1000) }}s ({{ retryAttempt+1 }}/{{ retryMax }}) — {{ (lastErrorMessage||'').slice(0,80) }}
          </span>
          <div class="retrybar" :title="`Retrying in ${Math.ceil(retryRemainingMs/1000)}s`">
            <div class="fill" :style="{ width: (retryPlannedMs>0? Math.max(0, Math.min(100, Math.round(100*(retryPlannedMs - retryRemainingMs)/retryPlannedMs))) : 0) + '%' }"></div>
          </div>
        </div>

        <div class="status" v-if="autoWaiting" style="display:flex;align-items:center;gap:8px">
          <span class="pill">
            <span class="spinner"></span> Auto wait {{ Math.ceil(autoWaitRemainingMs/1000) }}s before next request
          </span>
          <div class="retrybar" :title="`Auto wait ${Math.ceil(autoWaitRemainingMs/1000)}s`">
            <div class="fill" :style="{ width: (autoWaitPlannedMs>0? Math.max(0, Math.min(100, Math.round(100*(autoWaitPlannedMs - autoWaitRemainingMs)/autoWaitPlannedMs))) : 0) + '%' }"></div>
          </div>
        </div>

        <div class="muted">Edit the prompt anytime; applies next turn.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Styles are inherited from global styles.css for now */
</style>
