# Book Distiller (Petite‑Vue)

Live site: https://pankajkgarg.github.io/book-distiller2/

A tiny client‑side app that uploads a book (PDF/EPUB) and iteratively distills it using Google Gemini. Built with Petite‑Vue, no backend required.

## How It Works

See `docs/WORKFLOW.md` for the authoritative description of the request flow, retries, error handling, and file‑reference recovery. Keep this doc updated alongside code changes.

## Getting Started

- Install deps: `npm install`
- Start dev server: `npm run dev`
- Open the printed URL (e.g., `http://localhost:5173`)

## Scripts

- `npm run dev`: Vite dev server with hot reload
- `npm run build`: Production build to `dist/`
- `npm run preview`: Preview the built site locally

## Notes

- Keep your Gemini API key in the UI field; it’s stored in `localStorage` only on your machine.
- Model, prompt, and generation temperature persist in `localStorage` as well.
- External libs (Petite‑Vue, @google/genai, marked, jsPDF) are loaded from CDNs.
- Requests explicitly omit search tools so Gemini responds without Google Search grounding.
- System prompt is attached as `config.systemInstruction` (and temperature via `config.temperature`) per the official SDK docs.
- Left pane is simplified into clear steps:
  - Step 1 — enter your Gemini API key
  - Step 2 — choose a model
  - Step 3 — upload your book (PDF/EPUB)
  - Step 4 — edit the prompt
  - Advanced (collapsed): temperature (enabled by default at 1.0), end marker, budgets, anomaly pause toggle

## Export

- Filenames: exports use `<Book Name> - book excerpt.(md|txt|pdf)`, where `Book Name` is derived from the uploaded file’s name.
- Metadata:
  - `.md`: YAML front matter with `title`, `source_file`, `model`, `temperature`, `sections`, `date`, and `generator`.
  - `.txt`: A simple header with the same fields at the top of the file.
  - `.pdf`: PDF document properties are set (title, subject, keywords, creator). The content remains the distilled text; properties carry the metadata.

## Troubleshooting

- If you open `index.html` via `file://`, browsers block ESM scripts (CORS). Use the dev server (`npm run dev`) or any static server (e.g., `python3 -m http.server`).
- Ensure your network allows access to the CDNs and Google APIs.
 - Transient API errors auto‑retry with clear feedback:
  - 429 and 5xx: fixed 60s waits with a visible countdown, up to 5 automatic attempts; after that, the run pauses and shows “Resume”.
  - Network/other transient conditions: exponential backoff with a visible countdown.
 - Content anomalies:
   - Short/empty output: rejected and retried automatically (60s × 5) before pausing — except when the reply is exactly the end marker (e.g., `<end_of_book>`), which completes the run.
   - Leaked thoughts marker `<ctrl94>`: rejected and retried automatically (60s × 5) before pausing, and the bad turn is not added to history.

## UI Changes

- Top status now shows a colored badge and spinner while running.
- End marker is moved to Advanced settings and removed from the top bar.
- The rough token estimate after upload has been removed.
- You can delete any generated section; it is removed from both the live document and the conversation history used for the next turn.
 - Each Live Document section shows Gemini `candidatesTokenCount` (if present) next to the section title.

## Folder Layout

- `index.html`: Markup and component structure
- `styles.css`: Styles
- `app.js`: Petite‑Vue app and state (UI + flow)
- `gemini.js`: Gemini SDK wiring and retry/backoff helpers
  - Live Document renders each turn as a separate, titled section.

## Changelog

See `CHANGELOG.md` for notable changes.

## Contributing

Please see `AGENTS.md` for a brief checklist (remember to update the changelog for user‑facing changes).

## Deploy to GitHub Pages

This is a static site. The included GitHub Actions workflow publishes it to GitHub Pages on every push to `main`.

Steps:

1) GitHub → Settings → Pages → Build and deployment → Source: select “GitHub Actions”.
2) Push to `main` (or run the workflow manually). The site publishes at:
   `https://<your-username>.github.io/<repo-name>/`.

Notes:
- The workflow uploads the repository root (no build step required).
- If you prefer a built bundle via Vite, set `upload path: dist` and add a build step in the workflow (and set `base` in Vite config for subpath deploys).

---

Previously this project lived as a single HTML file. It’s now split into HTML/CSS/JS and served via Vite for a smooth local dev experience.
