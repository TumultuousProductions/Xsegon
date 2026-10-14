/*  What the whole page shares: the settings it was handed, where it is, what
    it is showing, and the elements it draws into. Only the module that
    declares an export may write it (from outside it is a TypeError), so
    anything written from more than one place goes through a setter here. */

export var S = (window.XSEGON && window.XSEGON.settings) || {};
/* A LaunchBox in use (index.php): without one nothing on screen mentions it.
   launchBoxOff is the folder set to nothing on purpose, which also hides the
   folder's own setting. hasGamesDb is separate: the Games Database ships with
   Xsegon, so its lookups are there either way unless filling goes to libretro. */
export var hasLaunchBox = !!(window.XSEGON && window.XSEGON.launchbox);
export var launchBoxOff = !!(S.paths && S.paths.launchbox === "");
// How many of the emulators in use sit inside a LaunchBox folder (index.php): the tool that moves them out shows only then.
export var emusInLaunchBox = (window.XSEGON && window.XSEGON.emusInLb) || 0;
export var hasGamesDb = !!(window.XSEGON && window.XSEGON.gamesdb);
export var games = [];
export var sel = 0;
export var busy = false;
export var view = (S.view && S.view.default) || "grid";
// "Systems first" is its own toggle, not a view, so the systems wheel combines with any view.
export var startInSystems = !!(S.view && S.view.systemsFirst);
if (view === "systems") { view = "grid"; startInSystems = true; }   // old stored value
if (view !== "grid" && view !== "list" && view !== "shelf" && view !== "wheel" && view !== "carousel" && view !== "rows") { view = "grid"; }

// null = not on the systems journey; "wall" = the carousel is showing;
// "inside" = a system was picked, and Esc brings the wall back.
export var sysStage = null;

export function setGames(v) { games = v; }
export function setSel(v) { sel = v; }
export function setBusy(v) { busy = v; }
// Named for the value, not the screen: setView() in views.js is the one that
// changes the view for real, and it calls this to record the choice.
export function setViewMode(v) { view = v; }
export function setSysStage(v) { sysStage = v; }
// The day Recently added starts from, as the server counts it (api\library.php).
export var addedSince = null;
export function setAddedSince(v) { addedSince = v; }

export var $body = document.body;
export var $view = document.getElementById("view");
export var $count = document.getElementById("count");
export var $status = document.getElementById("status");
export var $guard = document.getElementById("guardrail");
export var $strip = document.getElementById("strip");
export var $q = document.getElementById("q");
export var $platform = document.getElementById("platform");
export var $sort = document.getElementById("sort");
export var $added = document.getElementById("added");
export var $settings = document.getElementById("settings");
export var $details = document.getElementById("details");
export var $viewsel = document.getElementById("viewsel");
export var $main = document.getElementById("main");
export var $hero = document.getElementById("hero");
export var $help = document.getElementById("help");
export var $clock = document.getElementById("clock");
export var $bdA = document.getElementById("bd-a");
export var $bdB = document.getElementById("bd-b");
export var $syswall = document.getElementById("syswall");
export var $toolbar = document.getElementById("toolbar");
export var $info = document.getElementById("btn-info");
export var $logo = document.getElementById("brand-logo");
export var $btnSystems = document.getElementById("btn-systems");
export var $editor = document.getElementById("editor");
export var $offline = document.getElementById("offline");
