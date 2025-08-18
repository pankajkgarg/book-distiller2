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

## Folder Layout

- `index.html`: Markup and component structure
- `styles.css`: Styles
- `app.js`: Petite‑Vue app and Gemini requests

---

Previously this project lived as a single HTML file. It’s now split into HTML/CSS/JS and served via Vite for a smooth local dev experience.
