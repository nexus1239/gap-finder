# Gap Finder

- **Type:** Node.js CLI tool
- **Requires:** Node 18+
- **Dependencies:** None (uses built-in fetch)

## What This Is

Content gap analysis tool. Fetches top 10 Google results per keyword (via [SerpAPI](https://serpapi.com/)), identifies authority vs small sites, scores keywords 1-10 by opportunity, groups into topic clusters.

## Usage

```bash
node gap-finder.js
```

Reads keywords from `keywords.txt`, outputs `gap-report.md` and `gap-report.json`.

## Structure

- `gap-finder.js` — main script
- `keywords.txt` — input keywords (one per line)
- `.env` — SerpAPI key (`SERP_API_KEY`)
- `gap-report.*` — output files

## API Limits

Free tier: 100 searches/month via SerpAPI.
