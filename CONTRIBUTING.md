# Contributing to PipPad Player

Thanks for taking a look. This is a small, single-file project on purpose — easy
to read, easy to fork, easy to bend to your own kid's needs.

## Ground rules
- **Keep it single-file-friendly.** The worker is one `pip-player-worker.js` by
  design. Big refactors that add a build step should be discussed in an issue first.
- **No secrets, ever.** No API keys, account IDs, real IPs, emails, or personal
  domains in committed code. Use placeholders (`YOUR-NAS-IP`, `example.com`).
- **Calm-by-default.** New features should respect the de-stimulation ethos —
  nothing flashy or attention-grabbing in child mode.

## Workflow
1. Fork and create a branch: `git checkout -b feature/your-thing`
2. Test locally: `npx wrangler dev`
3. `node --check pip-player-worker.js` must pass.
4. Open a PR describing what changed and why.

## Ideas welcome
More presets, additional media sources, accessibility improvements, translations.
