<?php
/**
 * Xsegon - the front screen.
 *
 * The settings become body classes and style values here (from feel.* and
 * view.*), so the look is set before any script runs.
 */
declare(strict_types=1);

require_once __DIR__ . '/includes/import.php';

$s = xs_settings();

// Re-read LaunchBox if it moved, only for someone who turned Re-read on startup on with a folder set.
$autoImported = false;
if ($s['library']['importOnStartup'] && trim((string) $s['paths']['launchbox']) !== '' && xs_library_stale($s)) {
    $autoImported = (bool) (xs_import($s)['ok'] ?? false);
}

/* The look (includes\themes.php). A theme's values go on <html>, under the
   stylesheet's own names; the house look is none. What a look does not have
   is off whatever the switches say. */
require_once __DIR__ . '/includes/themes.php';
$theme = xs_theme_page($s);
$themeStyle = '';
foreach ((array) $theme['vars'] as $themeVar => $themeValue) { $themeStyle .= $themeVar . ': ' . $themeValue . ';'; }
// What it wears by name (a texture, what its panels are made of): words the stylesheet draws, or nothing.
$themeWears = '';
foreach ((array) ($theme['wears'] ?? []) as $themeDial => $themeWord) {
    if (preg_match('/^[a-z]+$/', (string) $themeDial) && preg_match('/^[a-z0-9-]+$/', (string) $themeWord)) { $themeWears .= ' data-' . $themeDial . '="' . $themeWord . '"'; }
}
$themeList = xs_theme_catalogue();

$bodyClass = [];
if (!$s['feel']['scanlines'] || !$theme['has']['scanlines']) { $bodyClass[] = 'no-scanlines'; }
if (!$s['feel']['glow'] || !$theme['has']['glow'])           { $bodyClass[] = 'no-glow'; }
if (!$s['feel']['animations']) { $bodyClass[] = 'no-anim'; }
if ($s['feel']['highContrast']) { $bodyClass[] = 'high-contrast'; }
if ($s['feel']['drawNearOnly'] ?? true) { $bodyClass[] = 'draw-near'; }
// Show badges off (the Badges menu's first entry): none of its marks is drawn, each keeps its own setting.
$marks = ($s['view']['showBadges'] ?? true) !== false;
if (empty($s['video']['markMissing']) || !$marks) { $bodyClass[] = 'no-novid'; }
if (empty($s['feel']['liveBackdrop'])) { $bodyClass[] = 'no-backdrop'; }
if (empty($s['feel']['helpBar']))      { $bodyClass[] = 'no-help'; }
if (empty($s['feel']['statusBar']))    { $bodyClass[] = 'no-status'; }
// An accent that is not cyan: a plain body class, so the CSS holds every colour.
$accent = (string) ($s['feel']['accent'] ?? 'cyan');
// It is the house look's own: a theme brings its highlight, and the choice waits.
if ($theme['house'] && in_array($accent, ['magenta', 'amber', 'green'], true)) { $bodyClass[] = 'accent-' . $accent; }
// Text brightness (feel.textBrightness): one number the stylesheet mixes
// the brightest whites from. Kept to 60..100 whatever the file says.
$textBright = max(60, min(100, (int) ($s['feel']['textBrightness'] ?? 100)));
$bodyStyle = $textBright < 100 ? '--tb: ' . ($textBright / 100) . ';' : '';
// Menu text size (feel.textSize): pixels for the settings' row names, which
// are drawn at 16 times --fs, so --fs is the size over 16.
$textPx = max(12, min(28, (int) ($s['feel']['textSize'] ?? 19)));
if ($textPx !== 16) { $bodyStyle .= '--fs: ' . round($textPx / 16, 4) . ';'; }
// Overall brightness (feel.brightness): how much black veils the window.
$bright = max(40, min(100, (int) ($s['feel']['brightness'] ?? 100)));
if ($bright < 100) { $bodyStyle .= '--dim: ' . round(1 - $bright / 100, 2) . ';'; }
/* Whether a LaunchBox is in use here. Without one nothing on screen talks
   about it: the page hides what only a LaunchBox library has (js/state.js hasLaunchBox). */
$lbPath = xs_norm_path((string) ($s['paths']['launchbox'] ?? ''));
$lbOn = $lbPath !== '' && is_dir($lbPath);
// Which badges are on (view.badges, the Badges menu): one body class each,
// so the marks are drawn by the stylesheet and a switch is one class.
if (!empty($s['view']['showPlayers']) && $marks) { $bodyClass[] = 'show-players'; }   // 1P / 2P marks
if (!empty($s['view']['listStripes'])) { $bodyClass[] = 'list-stripes'; }   // the list's striped rows
foreach ((array) ($s['view']['badges'] ?? []) as $badge => $on) {
    if ($on && $marks && preg_match('/^[a-z]+$/', (string) $badge)) { $bodyClass[] = 'badge-' . $badge; }
}
?>
<!DOCTYPE html>
<html lang="en" data-theme="<?= htmlspecialchars((string) $theme['id'], ENT_QUOTES) ?>"<?= $themeWears ?><?= $themeStyle !== '' ? ' style="' . htmlspecialchars($themeStyle, ENT_QUOTES) . '"' : '' ?>>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Xsegon</title>
<link rel="icon" type="image/png" sizes="32x32" href="/img/xsegon-32.png">
<link rel="icon" type="image/png" sizes="192x192" href="/img/xsegon-192.png">
<link rel="apple-touch-icon" href="/img/xsegon-180.png">
<?php
// Cache-bust on file mtime, so a fix to the CSS is never hidden behind the browser's old copy.
$cssV = @filemtime(__DIR__ . '/css/xsegon.css') ?: time();
// The page's scripts ride inside the page (the loader at the end of this file),
// read on every load. $jsV stamps main.js for the ordinary load, the way back.
// TODO: css\ with a long max-age, stamped from its own contents.
$jsV  = 0;
$jsN  = 0;                                  // how many scripts the page is
$jsPack = [];                               // each one's text, by file name
foreach (xs_glob(__DIR__ . '/js', '*.js') as $f) {
    $jsV = max($jsV, (int) @filemtime($f));
    $jsN++;
    $jsPack[basename((string) $f)] = (string) @file_get_contents((string) $f);
}
$jsV = $jsV ?: time();
?>
<link rel="stylesheet" href="css/xsegon.css?v=<?= $cssV ?>">
</head>
<body class="<?= htmlspecialchars(implode(' ', $bodyClass), ENT_QUOTES) ?>"<?= $bodyStyle !== '' ? ' style="' . htmlspecialchars($bodyStyle, ENT_QUOTES) . '"' : '' ?>>

<!-- The live backdrop: the selected game's art, blurred and dimmed. Two
     stacked images so the swap is a fade, never a pop. -->
<div class="backdrop" aria-hidden="true">
  <img id="bd-a" alt="">
  <img id="bd-b" alt="">
</div>

<div class="wrap">

  <header class="top">
    <div>
      <!-- The wordmark from the logo; the name stays the h1's text for a screen
           reader, in the alt. Where the menu bar is not (wheel, carousel, rows)
           it is the round X: a press opens Xsegon's own menu. -->
      <div class="brand">
        <h1 class="brand-logo" id="brand-logo" data-menu="xsegon"><img src="/img/xsegon-wordmark.png" alt="Xsegon" width="145" height="26"></h1>
        <!-- The status strip lives behind this: diagnostics, not needed to choose a game. -->
        <button type="button" id="btn-info" class="infobtn" title="Status info"
                aria-label="Status info" aria-controls="status"
                aria-expanded="<?= empty($s['feel']['statusBar']) ? 'false' : 'true' ?>">i</button>
      </div>
    </div>
    <div class="spacer"></div>
    <span class="clock" id="clock"></span>
    <!-- Contrast (below) applies instantly, then saves: a screen too dark to read needs no panel to fix it. -->
    <!-- The + (below): a game of your own, one press away from anywhere. -->
    <!-- The warning, minimised: a red mark that reopens it. -->
    <button type="button" id="warn-mark" class="warnmark" title="ROMs not plugged in. Click to read.">&#9651;</button>
    <!-- The mailbox: quiet things go here rather than in front of you. The dot
         asks for attention only until they are read. -->
    <!-- The dot stands beside the button, not inside it: every button clips
         what sticks out of it (the hover sweep needs that), which cut the dot in half. -->
    <!-- There only while the phone page is open (js\phone.js), so it is never open unseen. -->
    <button type="button" id="phone-mark" class="phonemark" title="The phone page is open. Click for Connect a phone..." aria-label="The phone page is open" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.5" y="3.5" width="9" height="17" rx="1.8"/><path d="M10.8 17.4h2.4"/></svg></button>
    <span class="mailwrap">
      <button type="button" id="btn-mail" class="mailbtn" title="Messages" aria-label="Messages">
        <span class="mail-ico" aria-hidden="true">&#9993;</span>
      </button>
      <span class="mail-dot" id="mail-dot" hidden></span>
    </span>
    <button type="button" id="btn-add" class="addbtn" title="Add a game of your own">+</button>
    <button type="button" id="btn-contrast" title="Brighter / dimmer (c)">Contrast</button>

    <!-- The view switch: the current view is the selected option, nothing to get out of sync. -->
    <?php
      $curView = $s['view']['default'];
      if (!in_array($curView, ['list', 'grid', 'shelf', 'wheel', 'carousel', 'rows'], true)) { $curView = 'grid'; }
      // The dropdown names what is ON SCREEN (paintSeg in js\views.js says why):
      // the consoles screen's own shape when Systems first puts it up, which it
      // does only for the wheel and the carousel.
      $shownView = $curView;
      if (!empty($s['view']['systemsFirst']) && in_array($curView, ['wheel', 'carousel'], true)) {
          $shownView = ($s['view']['systemsStyle'] ?? 'wheel') === 'carousel' ? 'carousel' : 'wheel';
      }
    ?>
    <!-- autocomplete off: a browser restores a select's last value on a
         reload, over the one the page was sent with, and the dropdown would
         open naming a view that is not the one on screen. -->
    <select id="viewsel" title="Game view (g cycles)" aria-label="View" autocomplete="off">
      <?php foreach (['list' => 'List', 'grid' => 'Grid', 'shelf' => 'Shelf', 'wheel' => 'Wheel', 'carousel' => 'Carousel', 'rows' => 'Rows'] as $k => $label): ?>
        <option value="<?= $k ?>"<?= $shownView === $k ? ' selected' : '' ?>><?= $label ?></option>
      <?php endforeach; ?>
    </select>
    <button type="button" id="btn-settings">Settings</button>

    <!-- The kiosk window has no title bar and Esc is the app's own Back, so
         these are the way out. Shown only inside the app window (js\appwindow.js
         decides); in an ordinary tab the browser already has both. -->
    <div class="winctl" id="winctl" hidden>
      <button type="button" id="btn-min" title="Minimise" aria-label="Minimise"><span class="minbar"></span></button>
      <button type="button" id="btn-close" class="wclose" title="Close Xsegon" aria-label="Close">&#10005;</button>
    </div>
  </header>

  <div class="status" id="status">
    <span class="stat"><span class="k">status</span><span class="v">reading&hellip;</span></span>
  </div>

  <!-- Two warnings can stand here at once and they belong together: the ROM
       drive being unplugged, and games whose files have gone. Each owns its
       own child so neither can wipe the other when it repaints. -->
  <div id="guardrail">
    <div id="guard-rom"></div>
    <div id="guard-news"></div>
  </div>

  <!-- What arrived, bottom right, briefly. Good news does not belong in the
       warning strip and does not need to be dismissed. -->
  <div id="toasts" class="toasts"></div>

  <div class="bar" id="toolbar">
    <!-- Only on the systems journey: the way back to the consoles for a
         mouse or a finger, where Esc is not within reach. -->
    <button type="button" id="btn-systems" title="Back to consoles (Esc)" aria-label="Back to consoles" hidden><svg viewBox="0 0 12 12" aria-hidden="true"><path d="M8 1.5 3.5 6 8 10.5"/></svg></button>
    <!-- The menu bar, for list and grid only. There the toolbar becomes this
         bar: js\menus.js puts .as-menubar on it and the CSS hides the sort and
         Random and moves search to the right end, so nothing moves in the page. -->
    <div class="mb" id="mb" role="menubar">
      <!-- Each menu is named for what is in it. The round X is Xsegon's own:
           its settings, the backup, and closing it. -->
      <button type="button" data-menu="xsegon" class="mb-orb" title="Xsegon" aria-label="Xsegon"></button>
      <button type="button" data-menu="games">Games</button>
      <button type="button" data-menu="media">Pictures &amp; Videos</button>
      <button type="button" data-menu="emulators">Emulators</button>
      <button type="button" data-menu="view">View</button>
      <button type="button" data-menu="arrange">Arrange By</button>
      <button type="button" data-menu="images">Image Group</button>
      <button type="button" data-menu="badges">Badges</button>
      <button type="button" data-menu="help">Help</button>
    </div>
    <!-- The search box carries Filter by at its right end; the funnel is lit
         with how many filters are on. -->
    <span class="qbox" id="qbox">
      <input type="search" id="q" placeholder="Search your games - type to filter" autocomplete="off" spellcheck="false">
      <button type="button" id="btn-filter" class="qfilter" tabindex="-1" aria-haspopup="dialog" aria-label="Filter by"></button>
      <!-- On the funnel's corner only while a filter is on: one press takes them all off. -->
      <button type="button" id="btn-filter-clear" class="qf-x" tabindex="-1" aria-label="Clear the filters" title="Clear the filters" hidden>&times;</button>
    </span>
    <!-- The platform picker shows the chosen console's icon, not its name (the
         strip over the table says it). The dropdown sits see-through over the
         face, so a click opens the same list. js\library.js paintPlatformFace paints it. -->
    <span class="pfpick" id="pfpick">
      <span class="pf-face" id="pf-face" aria-hidden="true">
        <img class="pf-ico" alt="" hidden>
        <svg class="pf-all" viewBox="0 0 24 24" hidden><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/></svg>
        <span class="pf-glyph" hidden></span>
        <svg class="pf-chev" viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg>
      </span>
      <select id="platform" aria-label="Platform" autocomplete="off"><option value="">All platforms</option></select>
    </span>
    <!-- How far back Recently added looks. Only up while that collection is
         open (js\library.js paintAddedPeriod); the choices are the setting's. -->
    <select id="added" aria-label="Recently added goes back" title="How far back Recently added looks" autocomplete="off" hidden>
      <?php foreach (xs_settings_schema()['view']['addedPeriod']['options'] as $k => $label): ?>
        <option value="<?= $k ?>"<?= ($s['view']['addedPeriod'] ?? 'month') === $k ? ' selected' : '' ?>><?= $label ?></option>
      <?php endforeach; ?>
    </select>
    <select id="sort" autocomplete="off">
      <?php // The same list as Arrange By in the menu bar, which drives this
            // dropdown: an option missing here is a menu entry that does nothing.
            foreach (['title' => 'A-Z', 'developer' => 'Developer', 'publisher' => 'Publisher',
                      'genre' => 'Genre', 'platform' => 'Platform', 'year' => 'Year',
                      'rating' => 'Rating', 'myrating' => 'Your rating', 'plays' => 'Play count', 'playtime' => 'Most played',
                      'recent' => 'Recently played', 'random' => 'Random',
                      // The list's other columns: their headers set these, so they must be here to be held.
                      'players' => 'Players', 'added' => 'Date added', 'favourite' => 'Favourite', 'tags' => 'Tags',
                      'cheats' => 'Cheats', 'missing' => 'Missing art', 'ready' => 'Ready', 'needsfix' => 'Needs fix',
                      'source' => 'Source', 'file' => 'File', 'docs' => 'Documents', 'hack' => 'Hack', 'discs' => 'Discs'] as $k => $label): ?>
        <option value="<?= $k ?>"<?= $s['view']['sort'] === $k ? ' selected' : '' ?>><?= $label ?></option>
      <?php endforeach; ?>
    </select>
    <button type="button" id="btn-random" title="Surprise me (r)">&#9861; Random</button>
    <span class="count" id="count"></span>
  </div>

  <!-- One container for every view. In list view the hero panel sits beside
       it: the selected game's art and story on the right. -->
  <!-- The consoles screen: pick one and it opens into whichever game view
       settings say. Esc brings it back. -->
  <div class="syswall" id="syswall" hidden></div>

  <div class="main" id="main">
    <div class="list" id="view">
      <!-- The start screen: a piece travels along the bar until the page is up.
           The stylesheet holds the bar back a second, so an ordinary start shows the words alone. -->
      <div class="empty boot-wait" id="boot-wait">
        <span id="boot-say" data-then="loading library&hellip;">starting Xsegon&hellip;</span>
        <div class="boot-more">
          <div class="fb-track wait"><span class="fb-fill"></span></div>
          <!-- The count under a bar that fills, for scripts arriving one by one:
          <span id="boot-count"></span> -->
        </div>
      </div>
    </div>
    <aside class="hero" id="hero" hidden></aside>
  </div>

  <!-- Details lives here, in the same window as the wheel: the wheel hides,
       this shows, and Back brings the wheel straight back. -->
  <div class="details" id="details" hidden></div>

</div>

<!-- The button legend: what the keys do, right now, in this context. -->
<footer class="help" id="help"></footer>

<!-- Volume: a speaker that opens into two bars, the film for video snaps and
     the X for Xsegon's own sounds; each bar's icon mutes that one alone. It sits
     over the legend's right end. The icons are put in by js\sound.js. -->
<div class="vol" id="vol">
  <div class="vol-pop" id="vol-pop" hidden>
    <div class="vol-row">
      <button type="button" class="vol-ico" id="vol-snap-ico"></button>
      <input type="range" id="vol-snap" min="0" max="100" step="1" aria-label="Video snap volume"
             title="Video snaps" value="<?= (int) ($s['sound']['videoVolume'] ?? 75) ?>">
      <span class="vol-num" id="vol-snap-num"></span>
    </div>
    <div class="vol-row">
      <button type="button" class="vol-ico" id="vol-app-ico"><img src="img/xsegon-32.png" alt=""></button>
      <input type="range" id="vol-range" min="0" max="100" step="1" aria-label="Xsegon volume"
             title="Xsegon's sounds (- and +)" value="<?= (int) ($s['sound']['volume'] ?? 70) ?>">
      <span class="vol-num" id="vol-num"></span>
    </div>
  </div>
  <button type="button" id="vol-btn" title="Volume" aria-label="Volume" aria-expanded="false"></button>
</div>

<!-- Settings is an overlay outside .wrap: inside it, it would open below the
     whole library, out of sight. -->
<div class="panel" id="settings" hidden></div>
<!-- Edit Metadata, from the right-click menu. Same overlay shape as settings.
     What it saves goes to data\overrides.json. -->
<div class="panel" id="editor" hidden></div>
<!-- What a console does when you walk away. Any real input dismisses it. -->
<div class="saver" id="saver" hidden></div>
<div class="strip" id="strip" hidden></div>
<!-- When the server stops answering, a kiosk window has nothing else to click.
     Built by js\offline.js the first time it is needed; on top of everything. -->
<div class="offline" id="offline" hidden></div>

<script>
  window.XSEGON = {
    settings: <?= json_encode($s, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>,
    autoImported: <?= $autoImported ? 'true' : 'false' ?>,
    // the look being worn and the ones to choose from (js\themes.js)
    theme: <?= json_encode($theme + ['list' => $themeList], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>,
    // The fast lane (includes\fastlane.php): where the reads a person waits on
    // go; null when it cannot be used. js\log.js falls back to this server
    // whenever it does not answer, or answers as anything but this folder's.
    fastLane: <?= json_encode((function () { require_once __DIR__ . '/includes/fastlane.php'; return xs_fast_lane_url(); })(), JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>,
    laneId: <?= json_encode(md5(strtolower(XS_ROOT))) ?>,
    // The phone page (includes\phone.php): started here when its switch was left on, and the top row's mark says so.
    phoneOn: <?= (function () { require_once __DIR__ . '/includes/phone.php'; return xs_phone_ensure()['on']; })() ? 'true' : 'false' ?>,
    launchbox: <?= $lbOn ? 'true' : 'false' ?>,
    // how many of the emulators in use sit inside a LaunchBox folder, which is read and never written (includes\emumove.php)
    emusInLb: <?= (function () { require_once __DIR__ . '/includes/emumove.php'; return xs_emumove_count(); })() ?>,
    // whether the Games Database is what fills games in (includes\gamesdb.php):
    // the copy that ships with Xsegon, and not turned off
    // (and, once a day, a newer one fetched in the background: xs_gamesdb_update_maybe)
    gamesdb: <?= (function () { require_once __DIR__ . '/includes/gamesdb.php'; xs_gamesdb_update_maybe(); return xs_details_from() === 'gamesdb'; })() ? 'true' : 'false' ?>,
    // private\web\main.js (js/main.js loads it): its stamp, or 0 where private\ is not
    private: <?= (int) @filemtime(__DIR__ . '/private/web/main.js') ?>,
    // the version and commit (in a package, which package), for the error bar's email (js/main.js)
    build: <?= json_encode((function () { require_once __DIR__ . '/includes/version.php'; return xs_version_short(); })(), JSON_UNESCAPED_SLASHES | JSON_HEX_TAG) ?>
  };
</script>
<!-- The start-up watchdog, a plain script that runs whatever becomes of the
     modules (the log is part of them). It logs an error before start-up, and a
     page whose code has not started in 45 seconds is reloaded once, then the app
     window is restarted (api\window.php). js\main.js sets booted. -->
<script>
  (function () {
    var X = window.XSEGON, KEY = "xs-boot-tries", seen = [];
    // every file in js\ is part of the page (tests\t-boot.js holds it to that)
    var N = <?= max(1, $jsN) ?>, got = [], po = null;
    var $wait = document.getElementById("boot-wait");
    function ms(n) { return Math.round(n) + "ms"; }
    function take(e) { if (/\/js\/[a-z0-9\-]+\.js(\?|$)/.test(e.name)) { got.push(e); } }
    function lastIn() { return got.reduce(function (m, e) { return Math.max(m, e.responseEnd); }, 0); }
    /* The bar that fills and its count, for scripts arriving one by one. Out
       of use: they ride inside the page, and the bar travels instead.
    function paint() {
      if (X.booted || !$wait || !$wait.isConnected) { return; }
      var n = Math.min(got.length, N);
      $wait.querySelector(".fb-fill").style.width = Math.round(100 * n / N) + "%";
      document.getElementById("boot-count").textContent = n + " of " + N + " parts";
    }
    */
    try {
      po = new PerformanceObserver(function (list) { list.getEntries().forEach(take); /* paint(); */ });
      po.observe({ type: "resource", buffered: true });
    } catch (e) { po = null; }                   // no way to time them here
    /* The wait is the library's from here. A view draws over it; the consoles
       screen hides it, so there it is taken away. The bar gives up after a
       minute: a read that failed must not leave one travelling. */
    function handOver() {
      if (!$wait || !$wait.isConnected) { return; }
      var say = document.getElementById("boot-say"), more = $wait.querySelector(".boot-more"), n = 0;
      say.textContent = say.getAttribute("data-then");
      // document.getElementById("boot-count").textContent = "";   (the count is out of use, above)
      $wait.querySelector(".fb-fill").style.width = "";
      $wait.querySelector(".fb-track").classList.add("wait");
      var look = setInterval(function () {
        if (!$wait.isConnected) { clearInterval(look); }
        else if (!$wait.offsetParent) { clearInterval(look); $wait.remove(); }
        else if (++n > 240) { clearInterval(look); more.remove(); }
      }, 250);
    }
    /* Called by js\main.js once the page's code is up. What it gives back is
       one log line on where the start went. It must never throw: main.js is
       still starting when it asks. */
    X.started = function () {
      try {
        var now = performance.now(), nav = performance.getEntriesByType("navigation")[0];
        if (po) { po.takeRecords().forEach(take); po.disconnect(); }
        handOver();
        var first = got.reduce(function (m, e) { return Math.min(m, e.startTime); }, Infinity), end = lastIn();
        var each = function (f) { return ms(got.reduce(function (t, e) { return t + Math.max(0, f(e)); }, 0) / got.length); };
        var slow = got.reduce(function (m, e) { return !m || e.duration > m.duration ? e : m; }, null);
        var line = "start-up took " + ms(now) + ": the page " + (nav ? ms(nav.responseEnd) : "not timed");
        if (got.length) {
          line += ", " + got.length + " of " + N + " scripts " + ms(end - first) +
                  " (each on average: connecting " + each(function (e) { return e.connectEnd - e.connectStart; }) +
                  ", waiting " + each(function (e) { return e.responseStart - e.requestStart; }) +
                  ", receiving " + each(function (e) { return e.responseEnd - e.responseStart; }) +
                  "; slowest " + slow.name.replace(/^.*\/|\?.*$/g, "") + " " + ms(slow.duration) + "), running them " + ms(now - end);
        } else if (X.glued) {
          line += ", its " + X.glued + " scripts inside it, making and running them " + ms(now - (nav ? nav.responseEnd : 0));
        } else { line += ", its scripts not timed"; }
        return line + "; " + (navigator.hardwareConcurrency || "?") + " processor threads, " +
               (navigator.deviceMemory ? navigator.deviceMemory + " GB memory" + (navigator.deviceMemory >= 8 ? " or more" : "") : "memory not told");
      } catch (e) { return "start-up was not timed (" + (e && e.message) + ")"; }
    };
    function stamp() {
      var t = new Date(), p = function (n, w) { return String(n).padStart(w || 2, "0"); };
      return p(t.getHours()) + ":" + p(t.getMinutes()) + ":" + p(t.getSeconds()) + "." + p(t.getMilliseconds(), 3);
    }
    function tell(msg) {
      try {
        fetch("api/log.php", { method: "POST", headers: { "Content-Type": "application/json" },
                               body: JSON.stringify({ lines: [[stamp(), "BOOT", msg]] }), keepalive: true }).catch(function () {});
      } catch (e) { /* nothing left to tell it with */ }
    }
    function tries(n) {
      try { if (n === undefined) { return Number(sessionStorage.getItem(KEY)) || 0; } sessionStorage.setItem(KEY, String(n)); } catch (e) { /* fine */ }
      return 0;
    }
    window.addEventListener("error", function (e) {
      if (X.booted) { return; }                  // from here on log.js hears errors itself
      var t = e.target;
      var file = t && t.tagName === "SCRIPT" ? t.src : (e.filename || "");
      if (!(e instanceof ErrorEvent) && !(t && t.tagName === "SCRIPT")) { return; }   // a picture that did not load
      seen.push(1);
      tell("before start-up: " + (e.message || "a script did not load") + (file ? " (" + file.replace(location.origin + "/", "") + (e.lineno ? ":" + e.lineno : "") + ")" : ""));
    }, true);
    // 45 seconds. Only tests\t-boot.js asks for less, to see both tries through.
    var WAIT = 45000;
    try { WAIT = Number(sessionStorage.getItem("xs-boot-wait")) || WAIT; } catch (e) { /* 45 it is */ }
    setTimeout(function () {
      if (X.booted) { tries(0); return; }
      var app = /[?&]app=1/.test(location.search), n = tries();
      // how far the scripts had got tells a slow start from a stuck one
      var far = X.glued ? ": its " + X.glued + " scripts were inside the page"
              : po ? ": " + Math.min(got.length, N) + " of " + N + " scripts had arrived" +
                     (got.length ? ", the last " + ms(performance.now() - lastIn()) + " ago" : "") : "";
      tell("the page's code has not started after " + Math.round(WAIT / 1000) + "s" + far + (seen.length ? "" : ", with no error seen") +
           (n === 0 ? "; reloading once" : app ? "; asking for the window to be restarted" : "; a tab, so left as it is"));
      if (n === 0) { tries(1); location.reload(); return; }
      tries(0);
      var v = document.getElementById("view");
      if (v) { v.textContent = app ? "Xsegon did not start. Restarting its window..." : "Xsegon did not start. Close this tab and open Xsegon again."; }
      if (app) {
        fetch("api/window.php", { method: "POST", headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ op: "restart" }) }).catch(function () {});
      }
    }, WAIT);
  })();
</script>
<!-- The page's scripts: every file in js\ rides in here as text, and the lines
     after make each the module the browser knows by its usual address, so one
     request replaces one per file. A browser that cannot do this, or anything
     going wrong first, loads js\main.js the ordinary way instead. -->
<script type="application/json" id="xs-pack"><?= json_encode($jsPack, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_INVALID_UTF8_SUBSTITUTE) ?: '{}' ?></script>
<script>
  (function () {
    function ordinary() {
      var s = document.createElement("script");
      s.type = "module";
      s.src = "js/main.js?v=<?= $jsV ?>";
      document.body.appendChild(s);
    }
    var at = location.origin + "/js/";
    try {
      // Only on proof the browser reads an import map: otherwise the old way.
      if (!window.HTMLScriptElement || !HTMLScriptElement.supports || !HTMLScriptElement.supports("importmap")) { ordinary(); return; }
      var box = document.getElementById("xs-pack"), pack = JSON.parse(box.textContent), names = Object.keys(pack), map = {};
      box.remove();
      if (!pack["main.js"]) { ordinary(); return; }
      names.forEach(function (name) {
        // A module made here has no folder to be beside, so "./x.js" is written out in full.
        var src = pack[name].replace(/^(import\s+\{[^}]*\}\s+from\s+")\.\/([^"]+)(";)/gm, function (all, a, file, z) { return a + at + file + z; });
        map[at + name] = URL.createObjectURL(new Blob([src, "\n//# sourceURL=" + at + name], { type: "text/javascript" }));
      });
      var im = document.createElement("script");
      im.type = "importmap";
      im.textContent = JSON.stringify({ imports: map });
      document.head.appendChild(im);
      window.XSEGON.glued = names.length;
    } catch (e) { ordinary(); return; }
    var go = document.createElement("script");
    go.type = "module";
    go.textContent = "import " + JSON.stringify(at + "main.js") + ";";
    document.body.appendChild(go);
  })();
</script>
</body>
</html>
