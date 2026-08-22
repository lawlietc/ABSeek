# ABSeek

> Turn scattered news into ready-to-publish info graphics.

English | [中文](./README.md)

ABSeek is a **local-first** news aggregation and image-generation tool that helps content creators collect, curate, and render multi-source news into mobile-friendly images for social media publishing.

- Local-first, your data stays yours (briefs are plain Markdown files)
- AI-friendly collaboration (external AI tools can read/write directly)
- Template-based rendering (HTML/CSS, WYSIWYG)
- Attribute-driven routing (one brief auto-matches templates by aspect, generating multiple images)
- Zero external services (no Docker / database / server)

---

## Features

### Collection
- RSS sources (ign / eurogamer / polygon, etc.) and static page crawling
- Scheduled collection (node-cron) with proxy support
- Auto deduplication (URL + content hash dual index)

### Brief Management
- Briefs stored as Markdown files (YAML frontmatter + body)
- Fields: title / summary (bilingual) / tags / category / aspect (A/B) / status / custom attributes
- State machine: raw → processed → reviewed → exported
- Non-gaming-industry items can be marked `excluded` and skipped

### Template Rendering
- HTML/CSS templates with Handlebars syntax
- Auto aspect → template binding (`default-bindings.json`)
- Pagination (max N briefs per page, auto-paginate on overflow)
- Multi-language output (zh / en, fallback on missing)
- 9:16 vertical output (1080×1920), mobile-friendly

### Automation
- Dual independent cron tasks (collect + export)
- Persisted runtime state with retry on failure
- History capped at 50 entries

---

## Workflow

```
RSS / Web Crawl
        │
        ▼
   Auto-collect into briefs (raw)
        │
        ▼
   Agent processing (translate / industry filter / A-B routing / tagging)
        │
        ▼
   Manual review (optional)
        │
        ▼
   Render by template + aspect (paginated images)
        │
        ▼
   Publish to social platforms
```

**Core concept: A/B aspect**

Each brief is judged from the player's perspective and routed to different templates:
- **A side**: good news (new game announcements, DLC, release dates, price drops, high ratings, etc.)
- **B side**: bad news (delays, cancellations, price hikes, low ratings, server shutdowns, etc.)

---

## Example Output

<p align="center">
  <img src="docs/screenshots/template-a-A.jpg" width="280" alt="A side (good news)">
  <img src="docs/screenshots/template-a-B.jpg" width="280" alt="B side (bad news)">
  <img src="docs/screenshots/template-c-A.jpg" width="280" alt="template-c style">
</p>

> Images are 1080×1920 vertical, suitable for Weibo / Xiaohongshu / X / Instagram. Examples show the gaming-news scenario; templates are customizable.

---

## Developer Guide

### CLI

ABSeek ships an `abseek` CLI for external agents / scripts to orchestrate the full pipeline:

```bash
# Collect from all enabled sources
node out/main/cli.js collect --all --json

# List pending briefs (compact format)
node out/main/cli.js brief list --status raw --format compact

# Rule-based batch processing (industry filter / A-B routing / tagging)
node out/main/cli.js brief process --auto --json

# Export images (with auto date fallback)
node out/main/cli.js export --status processed --lang zh --auto-date --json

# View aspect → template bindings
node out/main/cli.js bindings list

# Print AGENT_GUIDE.md path
node out/main/cli.js guide
```

Run `node out/main/cli.js --help` for the full command reference.

### abseek-daily Skill

The project bundles a [Trae Skill](.trae/skills/abseek-daily/SKILL.md) that orchestrates the complete pipeline: collect → process briefs → export → triple-check reporting. An agent can invoke this skill to run the daily news-to-image flow in one shot.

### Architecture

```
electron/
  main/
    collector/    Collection (RSS / crawler / scheduler / dedup / proxy)
    store/        Data layer (BriefRepo / ConfigRepo / Validator / Watcher)
    core/         Rendering core (Router / Render / Screenshot / AutoExport)
    automation/   Automation (cron tasks / state management)
    rules/        Rule engine
    logger/       Logging
cli/
  index.ts        CLI entry (reuses all electron/main modules, zero duplication)
src/              Electron renderer (React GUI)
templates/        Render templates (HTML / CSS / config.json)
data/             Runtime data (briefs / config / logs)
tests/            Unit + integration tests
```

### Conventions

- Brief files: `data/briefs/{YYYY-MM-DD}/{id}.md`
- Template files: `templates/{templateId}/` (config.json / index.html / style.css)
- Aspect bindings: `data/config/default-bindings.json`
- Output images: `output/<profile>/images/{YYYY-MM-DD}/` (gitignored, managed separately)

---

## User Guide

### Installation

```bash
git clone https://github.com/lawlietc/ABSeek.git
cd ABSeek
npm install
```

### Launch GUI

```bash
npm run dev
```

Opens the Electron app for visual operation: configure sources → browse brief list → edit briefs → pick template and export.

### Configure Sources

Via the "Collector" panel in the GUI, or by editing `data/config/sources.json` directly:

```json
{
  "sources": [
    {
      "id": "ign",
      "name": "IGN",
      "type": "rss",
      "url": "https://feeds.ign.com/ign/all",
      "enabled": true,
      "defaultTags": ["gaming"]
    }
  ]
}
```

### Proxy

Collecting overseas sources requires a local Clash proxy running on `127.0.0.1:7890` (port configurable in `data/config/settings.json`).

---

## Development

### Build

```bash
npm run build      # electron-vite build
npm run typecheck  # type checking
npm test           # run tests
```

### Testing

```bash
npm test           # all tests
npm run test:watch # watch mode
```

Coverage: collector / dedup / briefRepo / ruleEngine / validator / automation / scheduler / proxy / watcher.

---

## License

[MIT](LICENSE)
