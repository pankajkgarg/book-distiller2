# Book Distiller (Petite‑Vue)

A tiny client‑side app that uploads a book (PDF/EPUB) and iteratively distills it using Google Gemini. Built with Petite‑Vue, no backend required.

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

## Troubleshooting

- If you open `index.html` via `file://`, browsers block ESM scripts (CORS). Use the dev server (`npm run dev`) or any static server (e.g., `python3 -m http.server`).
- Ensure your network allows access to the CDNs and Google APIs.
- Transient API errors (429/5xx/network) auto‑retry with exponential backoff; you’ll see a countdown and error snippet in the top status bar.

## Folder Layout

- `index.html`: Markup and component structure
- `styles.css`: Styles
- `app.js`: Petite‑Vue app and state (UI + flow)
- `gemini.js`: Gemini SDK wiring and retry/backoff helpers
  - Live Document renders each turn as a separate, titled section.

## Changelog

See `CHANGELOG.md` for notable changes.

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
