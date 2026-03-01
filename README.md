# gap-finder

A Node.js CLI tool that finds content gap opportunities by analysing Google search results for a list of seed keywords. No npm dependencies — just built-in Node.js modules.

## What it does

For each keyword in `keywords.txt`, it:
1. Fetches the top 10 Google results via [SerpAPI](https://serpapi.com/)
2. Identifies whether each result is an authority site or a smaller blog
3. Measures description length (thin content signal) and title quality
4. Scores each keyword by opportunity (1–10)
5. Groups keywords into topic clusters
6. Outputs `gap-report.md` (human-readable) and `gap-report.json` (full data)

## Requirements

- **Node.js 18+** (for built-in `fetch`)
- A **SerpAPI** API key ([serpapi.com](https://serpapi.com/))

## Setup

### 1. Get API credentials

1. Sign up at [serpapi.com](https://serpapi.com/)
2. Go to your [dashboard](https://serpapi.com/manage-api-key) and copy your **API key**

> **Free tier:** SerpAPI allows **100 searches/month** free. Each run of this tool uses 1 query per keyword (10 keywords = 10 queries).

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and fill in your credentials:

```
SERP_API_KEY=your_serpapi_key_here
```

### 3. Edit keywords

Edit `keywords.txt` — one keyword per line. Lines starting with `#` are ignored.

```
best nootropics for focus
modafinil alternatives natural
lion's mane benefits
# this line is a comment and will be skipped
```

### 4. Run

```bash
node gap-finder.js
```

Or:

```bash
npm start
```

## Output

After running, two files are created in the same directory:

| File | Description |
|------|-------------|
| `gap-report.md` | Human-readable report with tables, scores, and cluster groups |
| `gap-report.json` | Full structured data for further processing |

### Console output example

```
🔍  Gap Finder — 10 keywords to analyse
    API delay: 700ms between requests

  [ 1/10] "best nootropics for focus" … ✓  10 results | score 6/10 | 40% small blogs
  [ 2/10] "nootropic stack for studying" … ✓  10 results | score 8/10 | 70% small blogs
  ...

✅  Done!

📊  Top opportunities:
    1. "nootropic stack for studying" — score 8/10 | 70% small blogs | 12 words avg desc
    2. "racetam comparison" — score 7/10 | 60% small blogs | 14 words avg desc
    ...

📄  Reports written:
    → /home/user/Projects/gap-finder/gap-report.json
    → /home/user/Projects/gap-finder/gap-report.md
```

## Priority Score

Scores are calculated per keyword on a 1–10 scale:

| Factor | Max Points | Logic |
|--------|-----------|-------|
| Small blog ratio | 4 | More small blogs in top 10 = easier to compete |
| Avg description word count | 3 | <8 words = very thin content signal |
| Generic/weak title ratio | 2 | Weak titles = under-optimised competitors |
| Sparse results (<7) | 1 | Low result count signals niche gap |

**Score 8–10 🔥** — High opportunity, target first
**Score 5–7 📈** — Achievable with quality content
**Score 1–4 🏔️** — Authority-dominated, harder to break into

## Adding more keywords

Just add lines to `keywords.txt`. Each line = one API call, so be mindful of your monthly quota (100 free/month on SerpAPI).

## Troubleshooting

| Error | Fix |
|-------|-----|
| `Missing env var` | Check `.env` exists and has `SERP_API_KEY` filled in |
| `HTTP 403` | API key invalid or account issue — check [serpapi.com/manage-api-key](https://serpapi.com/manage-api-key) |
| `HTTP 429` | Rate limited — wait a bit or check your plan's monthly quota |
| `Node.js 18+ required` | Upgrade Node: `nvm install 18 && nvm use 18` |
