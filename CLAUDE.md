# Gap Finder

- **Type:** Node.js CLI tool
- **Requires:** Node 18+
- **Dependencies:** None (uses built-in fetch)

## What This Is

Content gap analysis tool. Fetches top 10 Google results per keyword (via Custom Search API), identifies authority vs small sites, scores keywords 1-10 by opportunity, groups into topic clusters.

## Usage

```bash
node gap-finder.js
```

Reads keywords from `keywords.txt`, outputs `gap-report.md` and `gap-report.json`.

## Structure

- `gap-finder.js` — main script
- `keywords.txt` — input keywords (one per line)
- `.env` — Google API key and Search Engine ID
- `gap-report.*` — output files

## API Limits

Free tier: 100 queries/day via Google Custom Search API.
