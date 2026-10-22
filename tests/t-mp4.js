/*  Xsegon's own video cutter and stream saver (includes\mp4.php), in ffmpeg's place:
    bin\videocut.php keeps the first seconds of a recording read over the web (World of
    Longplays), bin\streamsave.php joins a stream's pieces into one file (Steam's trailers).
    Both run on tests\media: four seconds of a test pattern and a tone, as one file and as a
    stream in pieces, served here with byte ranges. What they write is read back
    (tests\mp4-read.php): the same samples, byte for byte, with the index first. Nothing
    goes online.                                                                           */
"use strict";
const fs = require("fs");
const path = require("path");
const http = require("http");
const { execFile } = require("child_process");
const { api, ROOT, OUT } = require("./lib");

const MEDIA = path.join(ROOT, "tests", "media");
const run = (exe, args) => new Promise((done) => execFile(exe, args, { cwd: ROOT, windowsHide: true, encoding: "utf8", timeout: 60000 },
  (e, out, err) => done({ code: e ? (e.code || 1) : 0, out: String(out || ""), err: String(err || "").trim() })));

/* The stand-in web: tests\media with byte ranges; /whole/... answers every ask with the whole
   file, as a server that ignores ranges does; and three playlists a saver must refuse. */
function serve() {
  const playlists = {
    "/names-a-file.m3u8": "#EXTM3U\n#EXT-X-MAP:URI=\"file:///" + path.join(MEDIA, "stream", "init-stream0.m4s").replace(/\\/g, "/") + "\"\n#EXTINF:1,\nchunk.m4s\n#EXT-X-ENDLIST\n",
    "/ts.m3u8": "#EXTM3U\n#EXTINF:1,\npiece0.ts\n#EXTINF:1,\npiece1.ts\n#EXT-X-ENDLIST\n",
    "/locked.m3u8": "#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"key.bin\"\n#EXT-X-MAP:URI=\"stream/init-stream0.m4s\"\n#EXTINF:1,\nstream/chunk-stream0-00001.m4s\n#EXT-X-ENDLIST\n",
  };
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (playlists[url]) { res.writeHead(200); res.end(playlists[url]); return; }
    const whole = url.startsWith("/whole/");
    const file = path.join(MEDIA, url.replace(/^\/whole\//, "/"));
    if (!file.startsWith(MEDIA) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size;
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range || "");
    if (m && !whole && Number(m[1]) >= size) { res.writeHead(416, { "Content-Range": "bytes */" + size }); res.end(); return; }
    if (m && !whole) {
      const a = Number(m[1]), b = Math.min(size - 1, m[2] ? Number(m[2]) : size - 1);
      res.writeHead(206, { "Content-Range": "bytes " + a + "-" + b + "/" + size, "Content-Length": b - a + 1 });
      fs.createReadStream(file, { start: a, end: b }).pipe(res);
    } else {
      res.writeHead(200, { "Content-Length": size });
      fs.createReadStream(file).pipe(res);
    }
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

module.exports = async function (b, check) {
  const php = ((await api("api/status.php")).build || {}).phpExe;
  const dir = path.join(OUT, "mp4");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const server = await serve();
  const web = "http://127.0.0.1:" + server.address().port;
  const read = async (...args) => { const r = await run(php, [path.join(ROOT, "tests", "mp4-read.php"), ...args]); try { return JSON.parse(r.out); } catch (e) { return { error: r.out + r.err }; } };
  const cut = (url, to, secs) => run(php, ["-d", "display_errors=0", path.join(ROOT, "bin", "videocut.php"), url, to, String(secs)]);
  const save = (url, to, pieces) => run(php, ["-d", "display_errors=0", path.join(ROOT, "bin", "streamsave.php"), url, to].concat(pieces ? [pieces] : []));
  const S = path.join(MEDIA, "stream");
  const pieces = (n) => fs.readdirSync(S).filter((f) => f.startsWith("chunk-stream" + n + "-")).sort().map((f) => path.join(S, f));

  try {
    /* ---- the cut: the first two seconds of the four, over the web -------- */
    const out = path.join(dir, "cut.mp4");
    let r = await cut(web + "/clip.mp4", out, 2);
    check("the cutter keeps the first seconds of a recording on the web", [r.code, r.err, fs.existsSync(out)], [0, "", true]);
    const got = await read(out), want = await read(path.join(MEDIA, "clip.mp4"), "2");
    check("the cut is its picture and its sound, the index first", [got.top, (got.tracks || []).map((t) => t.kind)], [["ftyp", "moov", "mdat"], ["vide", "soun"]]);
    check("each track holds the recording's own first samples, byte for byte, with their timing and key frames",
      (got.tracks || []).map((t) => [t.n, t.bytes, t.sizes, t.durs, t.ctos, t.keys]), (want.tracks || []).map((t) => [t.n, t.bytes, t.sizes, t.durs, t.ctos, t.keys]));
    const pic = (got.tracks || [])[0] || {};
    check("about two seconds, starting on a key frame, of a four-second recording", [pic.secs >= 1.9 && pic.secs <= 2.2, pic.firstKey, ((await read(path.join(MEDIA, "clip.mp4"))).tracks || [{}])[0].secs >= 3.9],
      [true, true, true]);
    check("nothing of the cutter's own is left beside it", fs.readdirSync(dir).filter((f) => f.startsWith("cut.mp4.")), []);

    r = await cut(web + "/whole/clip.mp4", path.join(dir, "whole.mp4"), 2);
    check("a server that sends only whole files is not read whole: the cut stops and says why",
      [r.code, /only whole files/.test(r.err), fs.existsSync(path.join(dir, "whole.mp4")), fs.existsSync(path.join(dir, "whole.mp4.bytes"))], [1, true, false, false]);
    r = await cut(web + "/stream/master.m3u8", path.join(dir, "notvideo.mp4"), 2);
    check("something that is not a recording is refused in words", [r.code, /no index/.test(r.err), fs.existsSync(path.join(dir, "notvideo.mp4"))], [1, true, false]);
    r = await cut(web + "/nothing-here.mp4", path.join(dir, "gone.mp4"), 2);
    check("a recording that is not there is said, with its address", [r.code, /404/.test(r.err) && r.err.includes("nothing-here.mp4")], [1, true]);

    /* ---- the join: a stream's pieces, picture and sound apart, into one file ---- */
    const joined = path.join(dir, "joined.mp4");
    r = await save(web + "/stream/master.m3u8?t=1", joined, path.join(dir, "pieces"));
    check("the saver joins a stream on the web into one file, and takes its pieces away after",
      [r.code, r.err, fs.existsSync(joined), fs.existsSync(path.join(dir, "pieces"))], [0, "", true, false]);
    const j = await read(joined);
    const v = await read(path.join(S, "init-stream0.m4s"), ...pieces(0)), a = await read(path.join(S, "init-stream1.m4s"), ...pieces(1));
    check("the file is the stream's picture and its sound, the index first", [j.top, (j.tracks || []).map((t) => t.kind)], [["ftyp", "moov", "mdat"], ["vide", "soun"]]);
    check("every sample of both, byte for byte, with its timing and key frames",
      (j.tracks || []).map((t) => [t.n, t.bytes, t.sizes, t.durs, t.ctos, t.keys]),
      [v, a].map((x) => ((x.tracks || [])[0] || {})).map((t) => [t.n, t.bytes, t.sizes, t.durs, t.ctos, t.keys]));
    const local = path.join(dir, "local.mp4");
    r = await save("file:///" + path.join(S, "master.m3u8").replace(/\\/g, "/"), local);
    check("the same stream as files on this PC (the tests' stand-in) makes the same file, byte for byte",
      [r.code, fs.existsSync(local) && fs.readFileSync(local).equals(fs.readFileSync(joined)), fs.existsSync(local + ".pieces")], [0, true, false]);

    r = await save(web + "/names-a-file.m3u8", path.join(dir, "file.mp4"));
    check("a stream on the web that names a file on this PC is refused", [r.code, /not on the web/.test(r.err), fs.existsSync(path.join(dir, "file.mp4"))], [1, true, false]);
    r = await save(web + "/ts.m3u8", path.join(dir, "ts.mp4"));
    check("a stream of MPEG-TS pieces is refused in words", [r.code, /MPEG-TS/.test(r.err)], [1, true]);
    r = await save(web + "/locked.m3u8", path.join(dir, "locked.mp4"));
    check("a locked (encrypted) stream is refused in words", [r.code, /locked/.test(r.err)], [1, true]);
  } finally {
    server.close();
  }
};
