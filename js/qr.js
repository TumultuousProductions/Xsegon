/*  The square a phone's camera reads (a QR code), worked out here with no
    internet and no other program. Byte mode, error correction L, sizes 1 to 5
    only: one block of data, so nothing is interleaved and no size mark is drawn.

        qrMatrix(text)   rows of true (dark) and false, or null when the text is too long
*/

var QR_DATA = [0, 19, 34, 55, 80, 108];      // bytes of data a size holds at level L
var QR_ECC  = [0, 7, 10, 15, 20, 26];        // and of error correction

// Arithmetic in the field the code's error correction is done in (x^8 + x^4 + x^3 + x^2 + 1).
function qrMul(x, y) {
  var z = 0;
  for (var i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11D);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function qrDivisor(degree) {
  var r = [], root = 1;
  for (var i = 0; i < degree - 1; i++) { r.push(0); }
  r.push(1);
  for (i = 0; i < degree; i++) {
    for (var j = 0; j < r.length; j++) {
      r[j] = qrMul(r[j], root);
      if (j + 1 < r.length) { r[j] ^= r[j + 1]; }
    }
    root = qrMul(root, 2);
  }
  return r;
}

function qrRemainder(data, divisor) {
  var r = divisor.map(function () { return 0; });
  data.forEach(function (b) {
    var f = b ^ r.shift();
    r.push(0);
    divisor.forEach(function (c, i) { r[i] ^= qrMul(c, f); });
  });
  return r;
}

// The text as the code carries it: what kind, how long, the bytes, the filling, then the error correction.
function qrWords(bytes, size) {
  var bits = [], full = QR_DATA[size] * 8, data = [];
  var put = function (v, n) { for (var i = n - 1; i >= 0; i--) { bits.push((v >>> i) & 1); } };
  put(4, 4);
  put(bytes.length, 8);
  bytes.forEach(function (b) { put(b, 8); });
  put(0, Math.min(4, full - bits.length));
  put(0, (8 - bits.length % 8) % 8);
  for (var pad = 0xEC; bits.length < full; pad ^= 0xEC ^ 0x11) { put(pad, 8); }
  for (var i = 0; i < bits.length; i += 8) {
    var b = 0;
    for (var k = 0; k < 8; k++) { b = (b << 1) | bits[i + k]; }
    data.push(b);
  }
  return data.concat(qrRemainder(data, qrDivisor(QR_ECC[size])));
}

// The fifteen bits that say which pattern the data was turned with, written twice.
function qrFormat(m, fixed, n, pattern) {
  var data = (1 << 3) | pattern, rem = data;
  for (var i = 0; i < 10; i++) { rem = (rem << 1) ^ ((rem >>> 9) * 0x537); }
  var bits = ((data << 10) | rem) ^ 0x5412;
  var bit = function (k) { return ((bits >>> k) & 1) !== 0; };
  var set = function (x, y, dark) { m[y][x] = dark; fixed[y][x] = true; };
  for (i = 0; i <= 5; i++) { set(8, i, bit(i)); }
  set(8, 7, bit(6));
  set(8, 8, bit(7));
  set(7, 8, bit(8));
  for (i = 9; i < 15; i++) { set(14 - i, 8, bit(i)); }
  for (i = 0; i < 8; i++) { set(n - 1 - i, 8, bit(i)); }
  for (i = 8; i < 15; i++) { set(8, n - 15 + i, bit(i)); }
  set(8, n - 8, true);
}

var QR_PATTERNS = [
  function (x, y) { return (x + y) % 2 === 0; },
  function (x, y) { return y % 2 === 0; },
  function (x, y) { return x % 3 === 0; },
  function (x, y) { return (x + y) % 3 === 0; },
  function (x, y) { return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; },
  function (x, y) { return x * y % 2 + x * y % 3 === 0; },
  function (x, y) { return (x * y % 2 + x * y % 3) % 2 === 0; },
  function (x, y) { return ((x + y) % 2 + x * y % 3) % 2 === 0; }
];

// How hard a square is to read, by the standard's four counts: the pattern with the least is used.
function qrPenalty(m, n) {
  var score = 0, dark = 0, x, y;
  var line = function (get) {
    var s = "", run = 1;
    for (var i = 0; i < n; i++) {
      s += get(i) ? "1" : "0";
      if (i > 0 && get(i) === get(i - 1)) { run++; } else { if (run >= 5) { score += run - 2; } run = 1; }
    }
    if (run >= 5) { score += run - 2; }
    for (var at = 0; (at = s.indexOf("10111010000", at)) !== -1; at++) { score += 40; }
    for (at = 0; (at = s.indexOf("00001011101", at)) !== -1; at++) { score += 40; }
  };
  for (y = 0; y < n; y++) { (function (r) { line(function (i) { return m[r][i]; }); line(function (i) { return m[i][r]; }); }(y)); }
  for (y = 0; y < n; y++) {
    for (x = 0; x < n; x++) {
      if (m[y][x]) { dark++; }
      if (x + 1 < n && y + 1 < n && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) { score += 3; }
    }
  }
  return score + Math.floor(Math.abs(dark * 20 - n * n * 10) / (n * n)) * 10;
}

export function qrMatrix(text, forcePattern) {
  var bytes = Array.prototype.slice.call(new TextEncoder().encode(String(text)));
  var size = 1;
  while (size <= 5 && bytes.length > QR_DATA[size] - 2) { size++; }
  if (size > 5) { return null; }
  var n = size * 4 + 17, m = [], fixed = [], x, y, i;
  for (y = 0; y < n; y++) { m.push(new Array(n).fill(false)); fixed.push(new Array(n).fill(false)); }
  var set = function (px, py, dark) { m[py][px] = dark; fixed[py][px] = true; };
  // The dotted lines, the three corner marks with their light edge, and the small mark sizes 2 to 5 have.
  for (i = 0; i < n; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  [[3, 3], [n - 4, 3], [3, n - 4]].forEach(function (c) {
    for (var dy = -4; dy <= 4; dy++) {
      for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy)), fx = c[0] + dx, fy = c[1] + dy;
        if (fx >= 0 && fx < n && fy >= 0 && fy < n) { set(fx, fy, d !== 2 && d !== 4); }
      }
    }
  });
  if (size >= 2) {
    for (y = -2; y <= 2; y++) { for (x = -2; x <= 2; x++) { set(n - 7 + x, n - 7 + y, Math.max(Math.abs(x), Math.abs(y)) !== 1); } }
  }
  qrFormat(m, fixed, n, 0);                    // holds the places; the real bits come with the pattern chosen
  // The data, in pairs of columns from the right, up and then down, round what is fixed.
  var words = qrWords(bytes, size), at = 0;
  for (var right = n - 1; right >= 1; right -= 2) {
    if (right === 6) { right = 5; }
    for (var vert = 0; vert < n; vert++) {
      for (var j = 0; j < 2; j++) {
        x = right - j;
        y = ((right + 1) & 2) === 0 ? n - 1 - vert : vert;
        if (!fixed[y][x] && at < words.length * 8) {
          m[y][x] = ((words[at >>> 3] >>> (7 - (at & 7))) & 1) !== 0;
          at++;
        }
      }
    }
  }
  var turn = function (p) {
    for (var ty = 0; ty < n; ty++) { for (var tx = 0; tx < n; tx++) { if (!fixed[ty][tx] && QR_PATTERNS[p](tx, ty)) { m[ty][tx] = !m[ty][tx]; } } }
  };
  var best = 0, least = Infinity;
  for (var p = 0; p < 8; p++) {
    if (forcePattern !== undefined && forcePattern !== p) { continue; }
    turn(p);
    qrFormat(m, fixed, n, p);
    var cost = qrPenalty(m, n);
    if (cost < least) { least = cost; best = p; }
    turn(p);                                   // turning twice puts it back
  }
  turn(best);
  qrFormat(m, fixed, n, best);
  return m;
}
