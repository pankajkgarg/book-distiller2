# Agent Operating Notes

This repository uses a simple process to keep user‑visible changes documented and deployed.

What to always do

- Update `CHANGELOG.md` for any user‑facing change (UI, behavior, configuration, docs, CI).
- Use conventional commits (e.g., `feat:`, `fix:`, `docs:`, `ci:`, `refactor:`) so CHANGELOG stays tidy.
- Update `README.md` when:
  - UI/UX changes (screens, buttons, flows) occur
  - Deployment or configuration steps change (e.g., Pages workflow)
- Keep model options in `index.html` and default in `app.js` aligned with current Gemini documentation.
- Verify GitHub Pages workflow still succeeds after pushes to `main`.

Quick PR checklist

- [ ] CHANGELOG updated
- [ ] README updated (if applicable)
- [ ] Pages workflow unaffected or updated (if applicable)
- [ ] Commit message uses conventional style

