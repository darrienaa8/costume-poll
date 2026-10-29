/*
 * Tiny QR code generator: byte mode, versions 1-10 (up to ~200 characters at level M).
 * Follows the standard algorithm (ISO/IEC 18004), structured like Project Nayuki's MIT-licensed
 * reference implementation. Works in browsers and Node.
 *
 *   QR.encode(text, 'M')  -> array of rows of booleans (true = dark module)
 *   QR.toSvg(matrix, {border, fg, bg}) -> SVG string
 */
(function (root) {
  'use strict';

  var FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };
  var ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28],
  };
  var NUM_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8],
  };
  var MAX_VERSION = 10;

  function rawModules(ver) {
    var r = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      var n = Math.floor(ver / 7) + 2;
      r -= (25 * n - 10) * n - 55;
      if (ver >= 7) r -= 36;
    }
    return r;
  }

  function dataCodewords(ver, ecc) {
    return Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ecc][ver] * NUM_BLOCKS[ecc][ver];
  }

  /* Reed-Solomon over GF(2^8), polynomial 0x11D */
  function rsMul(x, y) {
    var z = 0;
    for (var i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11d);
      z ^= ((y >>> i) & 1) * x;
    }
    return z;
  }

  function rsDivisor(degree) {
    var r = [];
    for (var i = 0; i < degree; i++) r.push(0);
    r[degree - 1] = 1;
    var root = 1;
    for (var a = 0; a < degree; a++) {
      for (var j = 0; j < degree; j++) {
        r[j] = rsMul(r[j], root);
        if (j + 1 < degree) r[j] ^= r[j + 1];
      }
      root = rsMul(root, 2);
    }
    return r;
  }

  function rsRemainder(data, divisor) {
    var r = divisor.map(function () { return 0; });
    data.forEach(function (b) {
      var factor = b ^ r.shift();
      r.push(0);
      divisor.forEach(function (coef, i) { r[i] ^= rsMul(coef, factor); });
    });
    return r;
  }

  function alignPositions(ver, size) {
    if (ver === 1) return [];
    var n = Math.floor(ver / 7) + 2;
    var step = Math.ceil((ver * 4 + 4) / (n * 2 - 2)) * 2;
    var r = [6];
    for (var pos = size - 7; r.length < n; pos -= step) r.splice(1, 0, pos);
    return r;
  }

  function penalty(mod, size) {
    var result = 0;
    var x, y, i;
    var rows = [];
    var cols = [];
    for (y = 0; y < size; y++) {
      var rs = '';
      for (x = 0; x < size; x++) rs += mod[y][x] ? '1' : '0';
      rows.push(rs);
    }
    for (x = 0; x < size; x++) {
      var cs = '';
      for (y = 0; y < size; y++) cs += mod[y][x] ? '1' : '0';
      cols.push(cs);
    }
    rows.concat(cols).forEach(function (line) {
      var run = 1;
      for (i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) {
          run++;
        } else {
          if (run >= 5) result += 3 + (run - 5);
          run = 1;
        }
      }
      result += 40 * ((line.match(/(?=10111010000)/g) || []).length);
      result += 40 * ((line.match(/(?=00001011101)/g) || []).length);
    });
    for (y = 0; y < size - 1; y++) {
      for (x = 0; x < size - 1; x++) {
        var c = mod[y][x];
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) result += 3;
      }
    }
    var dark = 0;
    mod.forEach(function (row) { row.forEach(function (v) { if (v) dark++; }); });
    var total = size * size;
    result += (Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1) * 10;
    return result;
  }

  function encode(text, eccLevel) {
    var ecc = eccLevel || 'M';
    var bytes = Array.prototype.slice.call(new TextEncoder().encode(String(text)));

    var ver;
    for (ver = 1; ver <= MAX_VERSION; ver++) {
      var need = 4 + (ver <= 9 ? 8 : 16) + bytes.length * 8;
      if (need <= dataCodewords(ver, ecc) * 8) break;
    }
    if (ver > MAX_VERSION) throw new Error('That link is too long for this QR generator.');

    /* data bits */
    var bits = [];
    function push(val, len) { for (var i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    push(4, 4); // byte mode
    push(bytes.length, ver <= 9 ? 8 : 16);
    bytes.forEach(function (b) { push(b, 8); });
    var cap = dataCodewords(ver, ecc) * 8;
    push(0, Math.min(4, cap - bits.length));
    push(0, (8 - (bits.length % 8)) % 8);
    for (var pad = 0xec; bits.length < cap; pad ^= 0xec ^ 0x11) push(pad, 8);
    var data = [];
    for (var i = 0; i < bits.length; i += 8) {
      var v = 0;
      for (var j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      data.push(v);
    }

    /* error correction + interleave */
    var nb = NUM_BLOCKS[ecc][ver];
    var bel = ECC_PER_BLOCK[ecc][ver];
    var raw = Math.floor(rawModules(ver) / 8);
    var nShort = nb - (raw % nb);
    var shortLen = Math.floor(raw / nb);
    var div = rsDivisor(bel);
    var blocks = [];
    for (var b = 0, k = 0; b < nb; b++) {
      var dat = data.slice(k, k + shortLen - bel + (b < nShort ? 0 : 1));
      k += dat.length;
      var ec = rsRemainder(dat, div);
      if (b < nShort) dat.push(0);
      blocks.push(dat.concat(ec));
    }
    var all = [];
    for (var n = 0; n < blocks[0].length; n++) {
      for (var m = 0; m < blocks.length; m++) {
        if (n !== shortLen - bel || m >= nShort) all.push(blocks[m][n]);
      }
    }

    /* matrix */
    var size = ver * 4 + 17;
    var mod = [];
    var fn = [];
    for (var r = 0; r < size; r++) {
      mod.push(new Array(size).fill(false));
      fn.push(new Array(size).fill(false));
    }
    function setF(x, y, dark) { mod[y][x] = dark; fn[y][x] = true; }

    for (var t = 0; t < size; t++) { setF(6, t, t % 2 === 0); setF(t, 6, t % 2 === 0); }
    function finder(cx, cy) {
      for (var dy = -4; dy <= 4; dy++) {
        for (var dx = -4; dx <= 4; dx++) {
          var d = Math.max(Math.abs(dx), Math.abs(dy));
          var x = cx + dx;
          var y = cy + dy;
          if (x >= 0 && x < size && y >= 0 && y < size) setF(x, y, d !== 2 && d !== 4);
        }
      }
    }
    finder(3, 3); finder(size - 4, 3); finder(3, size - 4);

    var ap = alignPositions(ver, size);
    for (var ai = 0; ai < ap.length; ai++) {
      for (var aj = 0; aj < ap.length; aj++) {
        if ((ai === 0 && aj === 0) || (ai === 0 && aj === ap.length - 1) || (ai === ap.length - 1 && aj === 0)) continue;
        for (var dy = -2; dy <= 2; dy++) {
          for (var dx = -2; dx <= 2; dx++) setF(ap[ai] + dx, ap[aj] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }

    function drawFormat(mask) {
      var d = (FORMAT_BITS[ecc] << 3) | mask;
      var rem = d;
      for (var q = 0; q < 10; q++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
      var fb = ((d << 10) | rem) ^ 0x5412;
      function bit(i) { return ((fb >>> i) & 1) !== 0; }
      for (var q1 = 0; q1 <= 5; q1++) setF(8, q1, bit(q1));
      setF(8, 7, bit(6)); setF(8, 8, bit(7)); setF(7, 8, bit(8));
      for (var q2 = 9; q2 < 15; q2++) setF(14 - q2, 8, bit(q2));
      for (var q3 = 0; q3 < 8; q3++) setF(size - 1 - q3, 8, bit(q3));
      for (var q4 = 8; q4 < 15; q4++) setF(8, size - 15 + q4, bit(q4));
      setF(8, size - 8, true);
    }
    drawFormat(0);

    if (ver >= 7) {
      var vr = ver;
      for (var q = 0; q < 12; q++) vr = (vr << 1) ^ ((vr >>> 11) * 0x1f25);
      var vb = (ver << 12) | vr;
      for (var z = 0; z < 18; z++) {
        var dark = ((vb >>> z) & 1) !== 0;
        var a = size - 11 + (z % 3);
        var bb = Math.floor(z / 3);
        setF(a, bb, dark); setF(bb, a, dark);
      }
    }

    /* place codewords in the zigzag */
    var bi = 0;
    for (var right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (var vert = 0; vert < size; vert++) {
        for (var jj = 0; jj < 2; jj++) {
          var x = right - jj;
          var upward = ((right + 1) & 2) === 0;
          var y = upward ? size - 1 - vert : vert;
          if (!fn[y][x] && bi < all.length * 8) {
            mod[y][x] = ((all[bi >>> 3] >>> (7 - (bi & 7))) & 1) !== 0;
            bi++;
          }
        }
      }
    }

    function applyMask(mask) {
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var inv;
          switch (mask) {
            case 0: inv = (x + y) % 2 === 0; break;
            case 1: inv = y % 2 === 0; break;
            case 2: inv = x % 3 === 0; break;
            case 3: inv = (x + y) % 3 === 0; break;
            case 4: inv = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
            case 5: inv = ((x * y) % 2) + ((x * y) % 3) === 0; break;
            case 6: inv = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
            default: inv = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
          }
          if (!fn[y][x] && inv) mod[y][x] = !mod[y][x];
        }
      }
    }

    var bestMask = 0;
    var bestPenalty = Infinity;
    for (var mask = 0; mask < 8; mask++) {
      applyMask(mask);
      drawFormat(mask);
      var p = penalty(mod, size);
      if (p < bestPenalty) { bestPenalty = p; bestMask = mask; }
      applyMask(mask); // undo
    }
    applyMask(bestMask);
    drawFormat(bestMask);
    return mod;
  }

  function toSvg(matrix, opts) {
    opts = opts || {};
    var border = opts.border == null ? 4 : opts.border;
    var fg = opts.fg || '#000000';
    var bg = opts.bg || '#ffffff';
    var n = matrix.length;
    var size = n + border * 2;
    var d = '';
    for (var y = 0; y < n; y++) {
      var x = 0;
      while (x < n) {
        if (matrix[y][x]) {
          var w = 1;
          while (x + w < n && matrix[y][x + w]) w++;
          d += 'M' + (x + border) + ' ' + (y + border) + 'h' + w + 'v1h-' + w + 'z';
          x += w;
        } else {
          x++;
        }
      }
    }
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + size + ' ' + size +
      '" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="' + size +
      '" height="' + size + '" fill="' + bg + '"/><path d="' + d + '" fill="' + fg + '"/></svg>';
  }

  var api = { encode: encode, toSvg: toSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.QR = api;
})(typeof self !== 'undefined' ? self : this);
