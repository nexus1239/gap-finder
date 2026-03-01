#!/usr/bin/env node
'use strict';

const fs   = require('fs');
const path = require('path');
const { URL } = require('url');

// ============================================================
// Node version guard (fetch requires 18+)
// ============================================================
const [nodeMajor] = process.versions.node.split('.').map(Number);
if (nodeMajor < 18) {
  console.error(`❌  Node.js 18+ required (built-in fetch). You have v${process.versions.node}.`);
  process.exit(1);
}

// ============================================================
// .env loader (no dotenv dependency)
// ============================================================
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// ============================================================
// Constants
// ============================================================
const DELAY_MS = 700; // pause between API calls to respect rate limits

// Domains treated as major authority sites
const AUTHORITY_DOMAINS = new Set([
  'examine.com', 'healthline.com', 'webmd.com', 'mayoclinic.org',
  'nih.gov', 'ncbi.nlm.nih.gov', 'pubmed.ncbi.nlm.nih.gov',
  'medicalnewstoday.com', 'verywellhealth.com', 'verywellmind.com',
  'psychologytoday.com', 'drugs.com', 'rxlist.com', 'nccih.nih.gov',
  'wikipedia.org', 'reddit.com', 'quora.com', 'amazon.com',
  'health.harvard.edu', 'clevelandclinic.org', 'hopkinsmedicine.org',
  'mountsinai.org', 'scientificamerican.com', 'nature.com',
  'forbes.com', 'menshealth.com', 'shape.com', 'prevention.com',
  'livestrong.com', 'mindbodygreen.com', 'everydayhealth.com',
  'bodybuilding.com', 'examine.com',
]);

// Topic cluster definitions — first match wins
const CLUSTERS = [
  { name: 'Comparisons',            terms: ['vs ', 'versus', 'compare', 'comparison', 'difference between'] },
  { name: 'Adaptogens & Fungi',     terms: ["lion's mane", 'ashwagandha', 'rhodiola', 'adaptogen', 'mushroom'] },
  { name: 'Cholinergics',           terms: ['alpha gpc', 'citicoline', 'choline', 'acetylcholine'] },
  { name: 'Racetams',               terms: ['racetam', 'piracetam', 'aniracetam', 'oxiracetam'] },
  { name: 'Prescription Nootropics', terms: ['modafinil', 'armodafinil', 'adderall', 'ritalin', 'prescription', 'alternative'] },
  { name: 'Stacking Guides',        terms: ['stack', 'combination', 'combine', 'protocol'] },
  { name: 'Beginner Guides',        terms: ['beginner', 'starter', 'start with', 'getting started', 'introduction'] },
  { name: 'Mental Wellness',        terms: ['anxiety', 'stress', 'sleep', 'mood', 'calm', 'depression'] },
  { name: 'Productivity & Focus',   terms: ['focus', 'studying', 'study', 'productivity', 'concentration', 'cognitive'] },
  { name: 'Natural Nootropics',     terms: ['natural', 'herbal', 'plant', 'herb'] },
];

// ============================================================
// Helpers
// ============================================================
const delay = ms => new Promise(r => setTimeout(r, ms));

function extractDomain(urlStr) {
  try { return new URL(urlStr).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function isAuthority(domain) {
  if (AUTHORITY_DOMAINS.has(domain)) return true;
  for (const auth of AUTHORITY_DOMAINS) {
    if (domain.endsWith('.' + auth)) return true;
  }
  return false;
}

function countWords(text) {
  return text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
}

/**
 * A title is "generic" when it's short OR shares fewer than 40% of
 * the meaningful keyword words (length > 3).
 */
function isGenericTitle(title, keyword) {
  if (!title || title.length < 35) return true;
  const kwWords = keyword.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (kwWords.length === 0) return false;
  const titleLower = title.toLowerCase();
  const hits = kwWords.filter(w => titleLower.includes(w)).length;
  return hits < Math.ceil(kwWords.length * 0.4);
}

function assignCluster(keyword) {
  const kw = keyword.toLowerCase();
  for (const { name, terms } of CLUSTERS) {
    if (terms.some(t => kw.includes(t))) return name;
  }
  return 'General Nootropics';
}

// ============================================================
// SerpApi — Google Search (with retry + rate-limit handling)
// ============================================================
const MAX_RETRIES    = 3;
const INITIAL_BACKOFF_MS = 1000; // doubles each retry: 1s, 2s, 4s

async function fetchResults(keyword, apiKey) {
  const url = new URL('https://serpapi.com/search');
  url.searchParams.set('engine',  'google');
  url.searchParams.set('q',       keyword);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('num',     '10');
  url.searchParams.set('hl',      'en');
  url.searchParams.set('gl',      'us');

  let lastError;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.log(`    ↻ retry ${attempt}/${MAX_RETRIES} in ${backoff}ms …`);
      await delay(backoff);
    }

    let res;
    try {
      res = await fetch(url.toString());
    } catch (err) {
      lastError = new Error(`Network error: ${err.message}`);
      console.log(`    ⚠ Network error: ${err.message}`);
      continue; // retry on network failures
    }

    // --- 429 Rate Limited: always retry (with backoff) ---
    if (res.status === 429) {
      lastError = new Error('Rate limited (HTTP 429) — too many requests');
      console.log(`    ⚠ Rate limited (429) — backing off`);
      continue;
    }

    // --- 403 Forbidden: bad key or account issue, do NOT retry ---
    if (res.status === 403) {
      const body = await res.text();
      let detail = 'HTTP 403 Forbidden';
      try { detail = JSON.parse(body)?.error || detail; } catch { /* ignore */ }
      throw new Error(`Authentication failed (403): ${detail} — check your SERP_API_KEY`);
    }

    // --- Other non-OK status: retry on 5xx, fail immediately on 4xx ---
    if (!res.ok) {
      const body = await res.text();
      let detail = `HTTP ${res.status}`;
      try { detail = JSON.parse(body)?.error || detail; } catch { /* ignore */ }

      if (res.status >= 500) {
        lastError = new Error(`Server error (${res.status}): ${detail}`);
        console.log(`    ⚠ Server error (${res.status}): ${detail}`);
        continue; // retry on server errors
      }

      // 4xx (other than 429/403) — don't retry
      throw new Error(`Client error (${res.status}): ${detail}`);
    }

    // --- Success path ---
    const data = await res.json();
    if (data.error) throw new Error(`SerpAPI error: ${data.error}`);

    // SerpApi returns organic_results; map to the same shape the analyser expects
    return (data.organic_results || []).map(r => ({
      link:    r.link    || '',
      title:   r.title   || '',
      snippet: r.snippet || '',
    }));
  }

  // All retries exhausted
  throw new Error(`Failed after ${MAX_RETRIES} retries: ${lastError?.message || 'unknown error'}`);
}

// ============================================================
// Per-keyword analysis
// ============================================================
function analyzeKeyword(keyword, items) {
  const cluster = assignCluster(keyword);

  if (!items.length) {
    return { keyword, cluster, results: [], metrics: null, priorityScore: 7 };
  }

  const results = items.map(item => {
    const domain    = extractDomain(item.link || '');
    const authority = isAuthority(domain);
    const descWords = countWords(item.snippet);
    const generic   = isGenericTitle(item.title, keyword);
    return {
      url:              item.link  || '',
      domain,
      title:            item.title || '',
      description:      item.snippet || '',
      descriptionWords: descWords,
      isAuthority:      authority,
      hasGenericTitle:  generic,
    };
  });

  const n                = results.length;
  const smallBlogCount   = results.filter(r => !r.isAuthority).length;
  const genericCount     = results.filter(r => r.hasGenericTitle).length;
  const totalDescWords   = results.reduce((s, r) => s + r.descriptionWords, 0);
  const smallBlogRatio   = +(smallBlogCount / n).toFixed(2);
  const genericTitleRatio = +(genericCount / n).toFixed(2);
  const avgDescWords     = Math.round(totalDescWords / n);

  // Priority score: higher = easier opportunity
  let score = 0;
  score += smallBlogRatio * 4;                    // up to 4 pts — small blogs dominating
  if      (avgDescWords < 8)  score += 3;         // very thin content signals
  else if (avgDescWords < 15) score += 2;
  else if (avgDescWords < 25) score += 1;
  score += genericTitleRatio * 2;                 // up to 2 pts — weak titles
  if (n < 7) score += 1;                          // sparse results bonus

  const priorityScore = Math.min(10, Math.max(1, Math.round(score)));

  return {
    keyword,
    cluster,
    results,
    metrics: {
      resultCount:      n,
      smallBlogCount,
      authorityCount:   n - smallBlogCount,
      smallBlogRatio,
      genericTitleRatio,
      avgDescriptionWords: avgDescWords,
    },
    priorityScore,
  };
}

// ============================================================
// Markdown report generator
// ============================================================
function scoreEmoji(s) {
  return s >= 8 ? '🔥' : s >= 5 ? '📈' : '🏔️';
}

function mdKeywordBlock(a) {
  const m = a.metrics;
  let s = `### ${scoreEmoji(a.priorityScore)} \`${a.keyword}\` — Score: **${a.priorityScore}/10**\n\n`;
  s += `**Cluster:** ${a.cluster}  \n`;

  if (!m) {
    s += `_No results returned._\n\n`;
    return s;
  }

  s += `**Results found:** ${m.resultCount}  \n`;
  s += `**Small blogs ranking:** ${m.smallBlogCount}/${m.resultCount} (${Math.round(m.smallBlogRatio * 100)}%)  \n`;
  s += `**Authority sites ranking:** ${m.authorityCount}/${m.resultCount}  \n`;
  s += `**Avg description length:** ${m.avgDescriptionWords} words  \n`;
  s += `**Generic titles:** ${Math.round(m.genericTitleRatio * 100)}%\n\n`;

  s += `| # | Domain | Title | Desc Words | Type |\n`;
  s += `|---|--------|-------|-----------|------|\n`;
  for (let i = 0; i < a.results.length; i++) {
    const r = a.results[i];
    const type  = r.isAuthority ? '🏛️ Authority' : '📝 Small blog';
    const title = r.title.length > 55 ? r.title.slice(0, 55) + '…' : r.title;
    s += `| ${i + 1} | ${r.domain} | ${title} | ${r.descriptionWords} | ${type} |\n`;
  }
  s += '\n';
  return s;
}

function generateMarkdown(analyses, generatedAt) {
  const sorted       = [...analyses].sort((a, b) => b.priorityScore - a.priorityScore);
  const totalResults = analyses.reduce((s, a) => s + (a.metrics?.resultCount || 0), 0);
  const avgScore     = (analyses.reduce((s, a) => s + a.priorityScore, 0) / analyses.length).toFixed(1);

  const high   = sorted.filter(a => a.priorityScore >= 8);
  const medium = sorted.filter(a => a.priorityScore >= 5 && a.priorityScore < 8);
  const low    = sorted.filter(a => a.priorityScore < 5);

  // Build cluster map
  const clusterMap = {};
  for (const a of analyses) {
    (clusterMap[a.cluster] = clusterMap[a.cluster] || []).push(a);
  }

  let md = `# Keyword Gap Analysis Report\n\n`;
  md += `**Generated:** ${generatedAt}  \n`;
  md += `**Keywords analysed:** ${analyses.length}  \n`;
  md += `**Total results reviewed:** ${totalResults}  \n`;
  md += `**Average opportunity score:** ${avgScore}/10\n\n`;
  md += `---\n\n`;

  // Executive summary
  md += `## Executive Summary\n\n`;
  if (high.length) {
    md += `**🔥 Top opportunities:** ${high.map(a => `\`${a.keyword}\``).join(', ')}\n\n`;
  }
  const highSmallBlog = analyses.filter(a => (a.metrics?.smallBlogRatio || 0) > 0.6);
  const thinContent   = analyses.filter(a => (a.metrics?.avgDescriptionWords || 99) < 15);
  const errors        = analyses.filter(a => a.error);

  if (highSmallBlog.length) {
    md += `**Small blogs dominating (>60% small sites):** ${highSmallBlog.map(a => `\`${a.keyword}\``).join(', ')}\n\n`;
  }
  if (thinContent.length) {
    md += `**Thin content signals (<15 words avg description):** ${thinContent.map(a => `\`${a.keyword}\``).join(', ')}\n\n`;
  }
  if (errors.length) {
    md += `**⚠️ Keywords with fetch errors:** ${errors.map(a => `\`${a.keyword}\` (${a.error})`).join(', ')}\n\n`;
  }
  md += `---\n\n`;

  // Priority sections
  md += `## Keywords by Priority Score\n\n`;
  if (high.length) {
    md += `### 🔥 High Opportunity — Score 8–10\n\n`;
    md += `> These keywords have thin competition, small blogs ranking, and weak title optimisation. Target first.\n\n`;
    high.forEach(a => { md += mdKeywordBlock(a); });
  }
  if (medium.length) {
    md += `### 📈 Medium Opportunity — Score 5–7\n\n`;
    md += `> Competitive but achievable. Mix of authorities and smaller sites.\n\n`;
    medium.forEach(a => { md += mdKeywordBlock(a); });
  }
  if (low.length) {
    md += `### 🏔️ Harder to Rank — Score 1–4\n\n`;
    md += `> Dominated by authority domains. Worth targeting only with a strong existing domain.\n\n`;
    low.forEach(a => { md += mdKeywordBlock(a); });
  }

  md += `---\n\n`;

  // Cluster summary
  md += `## Topic Clusters\n\n`;
  for (const [cluster, items] of Object.entries(clusterMap)) {
    const clusterSorted   = [...items].sort((a, b) => b.priorityScore - a.priorityScore);
    const clusterAvgScore = (items.reduce((s, a) => s + a.priorityScore, 0) / items.length).toFixed(1);
    md += `### ${cluster} — avg score ${clusterAvgScore}/10\n\n`;
    for (const a of clusterSorted) {
      const m = a.metrics;
      md += `- ${scoreEmoji(a.priorityScore)} **${a.keyword}** — Score ${a.priorityScore}/10`;
      if (m) {
        md += `, ${Math.round(m.smallBlogRatio * 100)}% small blogs, ${m.avgDescriptionWords} words avg desc`;
      }
      md += '\n';
    }
    md += '\n';
  }

  md += `---\n\n`;
  md += `## How the Score is Calculated\n\n`;
  md += `| Factor | Max Points | Logic |\n`;
  md += `|--------|-----------|-------|\n`;
  md += `| Small blog ratio in top 10 | 4 | Higher % of small blogs = easier to compete |\n`;
  md += `| Avg description word count | 3 | <8 words = 3 pts, <15 = 2 pts, <25 = 1 pt |\n`;
  md += `| Generic/weak title ratio | 2 | Weak titles = under-optimised content |\n`;
  md += `| Sparse results (<7 found) | 1 | Signals low competition |\n\n`;
  md += `**Authority sites** are matched against a list of ~30 major health, medical, and reference domains.\n\n`;
  md += `**Generic titles** are flagged when <35 chars or when <40% of keyword words appear in the title.\n\n`;
  md += `_This report is a starting point — cross-reference with search volume data before committing to content production._\n`;

  return md;
}

// ============================================================
// Main
// ============================================================
async function main() {
  loadEnv();

  const apiKey = process.env.SERP_API_KEY;

  if (!apiKey) {
    console.error('❌  Missing env var. Set SERP_API_KEY in .env.');
    console.error('    Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  const kwPath = path.join(process.cwd(), 'keywords.txt');
  if (!fs.existsSync(kwPath)) {
    console.error('❌  keywords.txt not found. Create it with one keyword per line.');
    process.exit(1);
  }

  const keywords = fs.readFileSync(kwPath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  if (!keywords.length) {
    console.error('❌  keywords.txt is empty or contains only comments.');
    process.exit(1);
  }

  console.log(`\n🔍  Gap Finder — ${keywords.length} keywords to analyse`);
  console.log(`    API delay: ${DELAY_MS}ms between requests\n`);

  const analyses = [];

  for (let i = 0; i < keywords.length; i++) {
    const kw = keywords[i];
    process.stdout.write(`  [${String(i + 1).padStart(2)}/${keywords.length}] "${kw}" … `);

    try {
      const items    = await fetchResults(kw, apiKey);
      const analysis = analyzeKeyword(kw, items);
      analyses.push(analysis);

      const m = analysis.metrics;
      if (m) {
        console.log(`✓  ${m.resultCount} results | score ${analysis.priorityScore}/10 | ${Math.round(m.smallBlogRatio * 100)}% small blogs`);
      } else {
        console.log(`✓  0 results | score ${analysis.priorityScore}/10`);
      }
    } catch (err) {
      console.log(`✗  ${err.message}`);
      analyses.push({
        keyword: kw,
        cluster: assignCluster(kw),
        results: [],
        metrics: null,
        priorityScore: 0,
        error: err.message,
      });
    }

    // Rate-limit pause (skip after last keyword)
    if (i < keywords.length - 1) await delay(DELAY_MS);
  }

  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

  // Write outputs
  const jsonPath = path.join(process.cwd(), 'gap-report.json');
  const mdPath   = path.join(process.cwd(), 'gap-report.md');

  fs.writeFileSync(jsonPath, JSON.stringify({ generatedAt, analyses }, null, 2));
  fs.writeFileSync(mdPath,   generateMarkdown(analyses, generatedAt));

  // Console summary
  const sorted = [...analyses].sort((a, b) => b.priorityScore - a.priorityScore);
  const errors  = analyses.filter(a => a.error);

  console.log('\n✅  Done!\n');

  console.log('📊  Top opportunities:');
  sorted.slice(0, 5).forEach((a, i) => {
    const m = a.metrics;
    const details = m
      ? `score ${a.priorityScore}/10 | ${Math.round(m.smallBlogRatio * 100)}% small blogs | ${m.avgDescriptionWords} words avg desc`
      : `score ${a.priorityScore}/10`;
    console.log(`    ${i + 1}. "${a.keyword}" — ${details}`);
  });

  if (errors.length) {
    console.log(`\n⚠️   ${errors.length} keyword(s) failed — check API quota or credentials.`);
  }

  console.log(`\n📄  Reports written:`);
  console.log(`    → ${jsonPath}`);
  console.log(`    → ${mdPath}\n`);
}

main().catch(err => {
  console.error('\n💥  Fatal error:', err.message);
  process.exit(1);
});
