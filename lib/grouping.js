'use strict';
/*
 * Answer grouping for the costume poll.
 *
 * Two answers are "the same costume" when, after normalising, either
 *   - they contain the same words (ignoring filler like "the", "from", "costume"),
 *   - they differ only by spacing ("spider man" / "spiderman"),
 *   - they differ by a small typo, or
 *   - every word of the shorter answer appears in the longer one
 *     ("Gina" / "Gina from Martin", "the witch" / "witch").
 */

const STOP = new Set([
  'the', 'a', 'an', 'of', 'from', 'as', 'and', 'with', 'in', 'on', 'my', 'is',
  'it', 'its', 'i', 'think', 'costume', 'for', 'to', 'at', 'by', 'that', 'this', 'one',
]);
const SMALL_WORDS = new Set(['of', 'from', 'the', 'a', 'an', 'and', 'in', 'on', 'with', 'as', 'for', 'to', 'at', 'by']);

/** Lowercase, strip accents and punctuation, collapse whitespace. */
function normalize(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function canon(t) {
  // crude plural / possessive folding: witches -> witche, gina's -> gina
  return t.length > 3 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t;
}

/** Significant, canonical words of an answer. */
function tokensOf(text) {
  const norm = normalize(text);
  const all = norm ? norm.split(' ') : [];
  const kept = all.filter((t) => !STOP.has(t));
  return (kept.length ? kept : all).map(canon);
}

/** Optimal-string-alignment edit distance (counts adjacent swaps as 1). */
function distance(a, b) {
  const al = a.length;
  const bl = b.length;
  if (!al) return bl;
  if (!bl) return al;
  const d = [];
  for (let i = 0; i <= al; i++) d[i] = [i];
  for (let j = 1; j <= bl; j++) d[0][j] = j;
  for (let i = 1; i <= al; i++) {
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[al][bl];
}

const sorted = (s) => s.split('').sort().join('');

/** Same word, allowing a small typo. First letters must agree (keeps "ghost" != "host"). */
function fuzzyEq(a, b) {
  if (a === b) return true;
  if (!a || !b || a[0] !== b[0]) return false;
  const m = Math.max(a.length, b.length);
  if (m <= 3) return false;
  if (m === 4) return a.length === b.length && sorted(a) === sorted(b) && distance(a, b) === 1; // swapped letters only
  return distance(a, b) <= (m <= 8 ? 1 : 2);
}

/**
 * How alike two answers are, from their token lists.
 * 4 same words, 3 same apart from spacing, 2 whole-phrase typo, 1 partial overlap, 0 different.
 */
function matchScore(c, m) {
  if (!c.length || !m.length) return 0;
  if (c.join(' ') === m.join(' ')) return 4;
  const cj = c.join('');
  const mj = m.join('');
  if (cj === mj) return 3;
  if (cj.length >= 5 && mj.length >= 5 && fuzzyEq(cj, mj)) return 2;
  const [small, big] = c.length <= m.length ? [c, m] : [m, c];
  if (small.every((t) => big.some((u) => fuzzyEq(t, u)))) return 1;
  return 0;
}

/** Tidy an answer for display: trim, collapse spaces, drop edge punctuation. */
function cleanText(raw) {
  const t = String(raw).replace(/\s+/g, ' ').trim();
  const stripped = t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return stripped || t;
}

/** Title-case only when the guest typed all-lowercase or ALL CAPS. */
function pretty(text) {
  if (text !== text.toLowerCase() && text !== text.toUpperCase()) return text;
  return text
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/**
 * Distinct spellings within one group, most common first, ties broken by shortest.
 * The first entry is the group's display name.
 */
function variantsOf(raws) {
  const map = new Map();
  for (const raw of raws) {
    const key = normalize(raw);
    const e = map.get(key) || { key, count: 0, forms: new Map() };
    e.count++;
    const f = cleanText(raw);
    e.forms.set(f, (e.forms.get(f) || 0) + 1);
    map.set(key, e);
  }
  return [...map.values()]
    .map((e) => {
      const form = [...e.forms.entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0];
      return { key: e.key, text: pretty(form), count: e.count };
    })
    .sort((a, b) => b.count - a.count || a.key.length - b.key.length || a.key.localeCompare(b.key));
}

function displayName(raws) {
  const v = variantsOf(raws);
  return v.length ? v[0].text : '';
}

module.exports = { normalize, tokensOf, matchScore, cleanText, pretty, variantsOf, displayName };
