#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const [destination] = process.argv.slice(2);
if (!destination) {
  console.error('Usage: node build-feedback-vis.mjs <destination.html>');
  process.exit(1);
}

const root = '/Users/pankaj/work/content/book-distiller-petit-vuejs';
const candidates = [
  {
    id: 'v3v_vivid_high',
    label: 'A · exact envelope + vivid · high',
    path: 'temp/prompt_opt_k3/v3v__vivid/ch01.md',
    words: 1082,
    ratio: 46.5,
    excerpts: 15.7,
    exact: '4/4',
    tokens: 26861,
    seconds: 833,
  },
  {
    id: 'v4_qualitative_low',
    label: 'B · qualitative compression · low',
    path: 'temp/prompt_opt_k3/v4__qualitative_low/ch01.md',
    words: 1715,
    ratio: 73.6,
    excerpts: 12.7,
    exact: '4/5 strict · 5/5 content',
    tokens: 11402,
    seconds: 293,
  },
  {
    id: 'v4_1_survival_low',
    label: 'C · qualitative survival test · low',
    path: 'temp/prompt_opt_k3/v4_1__survival_low/ch01.md',
    words: 2039,
    ratio: 87.5,
    excerpts: 7.7,
    exact: '3/3',
    tokens: 11917,
    seconds: 333,
  },
  {
    id: 'v5_mapped_low',
    label: 'D · mapped develop/mention/omit · low',
    path: 'temp/prompt_opt_k3/v5__mapped_low/ch01.md',
    words: 1996,
    ratio: 85.7,
    excerpts: 10.4,
    exact: '5/5',
    tokens: 9423,
    seconds: 283,
  },
];

const escapeHtml = value => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

for (const candidate of candidates) {
  candidate.text = await readFile(`${root}/${candidate.path}`, 'utf8');
}

const options = candidates.map(candidate =>
  `      <option value="${candidate.id}">${candidate.label}</option>`
).join('\n');

const rows = candidates.map(candidate => `
      <tr data-row="${candidate.id}">
        <th scope="row">${candidate.label}</th>
        <td class="text-end">${candidate.words.toLocaleString()}</td>
        <td class="text-end">${candidate.ratio.toFixed(1)}%</td>
        <td class="text-end">${candidate.excerpts.toFixed(1)}%</td>
        <td class="text-end">${candidate.exact}</td>
        <td class="text-end">${candidate.tokens.toLocaleString()}</td>
        <td class="text-end">${candidate.seconds.toLocaleString()}</td>
      </tr>`).join('');

const templates = candidates.map(candidate => `
  <template data-candidate-text="${candidate.id}">${escapeHtml(candidate.text)}</template>`).join('');

const fragment = `<div id="kimi-distillation-feedback">
  <div class="viz-controls">
    <label class="form-label" for="kdf-candidate">Read candidate
      <select class="form-select" id="kdf-candidate">
${options}
      </select>
    </label>
  </div>

  <div class="table-responsive">
    <table class="table table-sm">
      <thead>
        <tr>
          <th scope="col">Candidate</th>
          <th scope="col" class="text-end">Output words</th>
          <th scope="col" class="text-end">Source retained</th>
          <th scope="col" class="text-end">Excerpt share</th>
          <th scope="col" class="text-end">Exact quotes</th>
          <th scope="col" class="text-end">API output tokens</th>
          <th scope="col" class="text-end">Seconds</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>

  <div class="viz-row kdf-selected-line" aria-live="polite">
    <span id="kdf-selected-label"></span>
    <span class="text-muted" id="kdf-selected-metric"></span>
  </div>
  <pre id="kdf-prose" aria-label="Selected Kimi distillation candidate"></pre>

  <div class="viz-controls kdf-feedback">
    <label class="form-label" for="kdf-length">Length and pacing
      <select class="form-select" id="kdf-length">
        <option value="just right">Just right</option>
        <option value="too short or compressed">Too short / compressed</option>
        <option value="too long or repetitive">Too long / repetitive</option>
        <option value="mixed">Mixed</option>
      </select>
    </label>
    <label class="form-label" for="kdf-notes">What to preserve or change
      <textarea class="form-control" id="kdf-notes" rows="3" placeholder="Examples, excerpts, pacing, missing lessons…"></textarea>
    </label>
    <button class="btn btn-primary" type="button" id="kdf-send">Send this feedback</button>
  </div>

${templates}
</div>

<style>
  #kimi-distillation-feedback {
    color: var(--foreground);
  }
  #kimi-distillation-feedback .kdf-selected-line {
    justify-content: space-between;
    margin-block: 1rem 0.5rem;
  }
  #kimi-distillation-feedback #kdf-prose {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    color: var(--foreground);
    background: transparent;
    margin: 0;
    padding: 0;
  }
  #kimi-distillation-feedback .kdf-feedback {
    align-items: end;
    margin-top: 1.25rem;
  }
  #kimi-distillation-feedback .kdf-feedback .form-label:nth-child(2) {
    flex: 1 1 20rem;
  }
  @media (max-width: 520px) {
    #kimi-distillation-feedback .kdf-selected-line {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>

<script>
(() => {
  const root = document.getElementById('kimi-distillation-feedback');
  const select = root.querySelector('#kdf-candidate');
  const prose = root.querySelector('#kdf-prose');
  const label = root.querySelector('#kdf-selected-label');
  const metric = root.querySelector('#kdf-selected-metric');
  const length = root.querySelector('#kdf-length');
  const notes = root.querySelector('#kdf-notes');
  const send = root.querySelector('#kdf-send');
  const data = ${JSON.stringify(Object.fromEntries(candidates.map(candidate => [candidate.id, {
    label: candidate.label,
    words: candidate.words,
    ratio: candidate.ratio,
    tokens: candidate.tokens,
  }])))};

  function render() {
    const id = select.value;
    const candidate = data[id];
    const template = root.querySelector('[data-candidate-text="' + id + '"]');
    prose.textContent = template.content.textContent.trim();
    label.textContent = candidate.label;
    metric.textContent = candidate.words.toLocaleString() + ' words · ' + candidate.ratio.toFixed(1) + '% of source · ' + candidate.tokens.toLocaleString() + ' API output tokens';
  }

  select.addEventListener('change', render);
  send.addEventListener('click', async () => {
    const candidate = data[select.value];
    const detail = notes.value.trim() || 'No additional notes.';
    const prompt = 'For the Kimi book-distillation prompt experiment, I prefer ' + candidate.label + '. My length/pacing verdict: ' + length.value + '. My notes: ' + detail + ' Please use this feedback before running or changing any further prompt.';
    if (window.openai && window.openai.sendFollowUpMessage) {
      await window.openai.sendFollowUpMessage({ prompt, title: 'Send distillation feedback' });
    }
  });
  render();
})();
</script>
`;

await writeFile(destination, fragment, 'utf8');
