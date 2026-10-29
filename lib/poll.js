'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const G = require('./grouping');

/**
 * Poll state, persisted to a JSON file.
 *   votes:  { id, raw, group, dev, ts }   dev = anonymous device id (cookie)
 *   groups: { id, customName }            the display name is computed from the votes
 */
class Poll {
  constructor(file, hostKeyFromEnv) {
    this.file = file;
    let s = null;
    try {
      s = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) { /* first run */ }
    if (!s || !Array.isArray(s.votes) || !Array.isArray(s.groups)) s = this._blank();
    this.s = s;
    this.s.hostKey = hostKeyFromEnv || s.hostKey || crypto.randomBytes(5).toString('hex');
    this.save();
  }

  _blank() {
    return { pollId: crypto.randomBytes(4).toString('hex'), seq: 1, votes: [], groups: [] };
  }

  get pollId() { return this.s.pollId; }
  get hostKey() { return this.s.hostKey; }

  save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.s));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('Could not save poll data:', e.message);
    }
  }

  hasVoted(dev) {
    return this.s.votes.some((v) => v.dev === dev);
  }

  _votesByGroup() {
    const map = new Map(this.s.groups.map((g) => [g.id, []]));
    for (const v of this.s.votes) map.get(v.group).push(v);
    return map;
  }

  addVote(raw, dev) {
    const tokens = G.tokensOf(raw);
    const byGroup = this._votesByGroup();
    let best = null;
    let bestScore = 0;
    let bestSize = -1;
    for (const g of this.s.groups) {
      const votes = byGroup.get(g.id);
      let score = 0;
      const seen = new Set();
      for (const v of votes) {
        const mt = G.tokensOf(v.raw);
        const key = mt.join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        score = Math.max(score, G.matchScore(tokens, mt));
        if (score === 4) break;
      }
      if (score > bestScore || (score > 0 && score === bestScore && votes.length > bestSize)) {
        best = g;
        bestScore = score;
        bestSize = votes.length;
      }
    }
    let gid;
    if (best) {
      gid = best.id;
    } else {
      gid = this.s.seq++;
      this.s.groups.push({ id: gid, customName: null });
    }
    this.s.votes.push({ id: this.s.seq++, raw, group: gid, dev, ts: Date.now() });
    this.save();
    return gid;
  }

  results() {
    const byGroup = this._votesByGroup();
    const entries = this.s.groups
      .map((g) => {
        const raws = byGroup.get(g.id).map((v) => v.raw);
        return { id: g.id, name: g.customName || G.displayName(raws), votes: raws.length };
      })
      .filter((e) => e.votes > 0)
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    const max = entries.length ? entries[0].votes : 0;
    return {
      pollId: this.s.pollId,
      total: this.s.votes.length,
      entries,
      leaders: max > 0 ? entries.filter((e) => e.votes === max).map((e) => e.id) : [],
    };
  }

  hostState() {
    const byGroup = this._votesByGroup();
    const groups = this.s.groups
      .map((g) => {
        const raws = byGroup.get(g.id).map((v) => v.raw);
        const variants = G.variantsOf(raws);
        return {
          id: g.id,
          name: g.customName || (variants[0] ? variants[0].text : ''),
          customName: g.customName,
          votes: raws.length,
          variants,
        };
      })
      .filter((g) => g.votes > 0)
      .sort((a, b) => b.votes - a.votes || a.name.localeCompare(b.name));
    return { pollId: this.s.pollId, total: this.s.votes.length, groups };
  }

  _group(id) {
    return this.s.groups.find((g) => g.id === id);
  }

  /** Merge several groups into one. Returns the surviving group id. */
  merge(ids, into) {
    const uniq = [...new Set(ids)].filter((id) => this._group(id));
    if (uniq.length < 2) throw new Error('Pick at least two entries to merge.');
    const byGroup = this._votesByGroup();
    let target = uniq.includes(into) ? into : null;
    if (target == null) {
      target = uniq.slice().sort((a, b) => byGroup.get(b).length - byGroup.get(a).length || a - b)[0];
    }
    for (const v of this.s.votes) if (uniq.includes(v.group)) v.group = target;
    const tg = this._group(target);
    if (!tg.customName) {
      const named = uniq.map((id) => this._group(id)).find((g) => g.customName);
      if (named) tg.customName = named.customName;
    }
    this.s.groups = this.s.groups.filter((g) => g.id === target || !uniq.includes(g.id));
    this.save();
    return target;
  }

  /** Move every vote with this exact (normalised) spelling out of a group into its own entry. */
  split(groupId, variantKey) {
    const g = this._group(groupId);
    if (!g) throw new Error('Entry not found.');
    const inGroup = this.s.votes.filter((v) => v.group === groupId);
    const moving = inGroup.filter((v) => G.normalize(v.raw) === variantKey);
    if (!moving.length) throw new Error('That spelling is no longer in this entry.');
    if (moving.length === inGroup.length) throw new Error('This entry only has one spelling, so there is nothing to split.');
    const gid = this.s.seq++;
    this.s.groups.push({ id: gid, customName: null });
    for (const v of moving) v.group = gid;
    this.save();
    return gid;
  }

  rename(groupId, name) {
    const g = this._group(groupId);
    if (!g) throw new Error('Entry not found.');
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
    g.customName = clean || null;
    this.save();
  }

  reset() {
    const hostKey = this.s.hostKey;
    this.s = this._blank();
    this.s.hostKey = hostKey;
    this.save();
  }
}

module.exports = { Poll };
