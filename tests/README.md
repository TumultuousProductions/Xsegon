# Xsegon tests

    node tests\run.js             every group, about fifteen minutes
    node tests\run.js menus own   only those groups
    node tests\lanes.js           every group but e2e, two at a time: about ten minutes
    node tests\lanes.js quick     the slow groups left out: about three minutes, for while you work
    node tests\run.js --live      against the Xsegon on 8099 instead

Needs PHP and Chrome or Edge on the machine. Nothing to install. A run
starts its own server on a copy of data\ (sandbox.js) and never touches the
Xsegon on 8099, so it is safe to play while it runs. The one exception is
the last group, e2e, which starts one real game in the real RetroArch for a
few seconds, twice, to prove what no stand-in can; skip it with a list of
groups, or expect a small game window near the end of a full run.

Groups:

| group   | what it walks |
|---------|---------------|
| modules | the shape of `js\`: import heads, nothing importing the entry, no listener put up while a module loads, no file over 700 lines. Reads the files, no browser |
| backup  | make an archive, read it back with an independent reader, restore one part and prove nothing else moved, export to a folder and import from a file (a hand-made zip taken, a stranger refused), the screens, and the zip itself through `tests\zip-probe.php` (the larger form past 4 GB, a damaged archive caught by the read-back) |
| api     | every endpoint's shape, the collections, sorting, the origin guard, the /files/ door (served, cached, ranged, and refusing every path trick sent as raw bytes); a process number reused by another program not taken for a job's worker |
| views   | the consoles screen in both styles, wheel, grid, list, carousel, keyboard movement, the sticky header, no page scroll on the wall, the info panel through a fast scroll, the fill to the legend and the scrollbars, the screensaver's pictures |
| menus   | the right-click menu, favourite on and off, details (the game's own Buttons door among them), hide and show again, Arrange By, group headers, Image Group, the View menu, the cards that say what a menu entry does, and RetroArch's hotkeys in the Controls panel |
| editing | Edit Metadata save and reset, Change Pictures, use no picture, Find online, video state; a left click on NO ART or a no-video mark offering both |
| own     | a game of your own: + button, add, launch (web), session, edit, refuse, remove |
| log     | the log: the codes a session writes, an error at once, a refused request, the viewer |
| steam   | Games > Add Steam games against a fixture Steam, Play without Steam, and the launcher following a game by its folder |
| filters | Filter by, the funnel in the search box: each filter against its collection, stacking, Ready to play with the ROM drive out, the funnel's light, the list staying up, the keys, View, the consoles screen and its menu (the pad's way) |
| sameviews | the search box and a filter, the same in all six views: what a word finds, a console's own name not counted inside it, the keys in the box (Down to the games, Esc empties and stays) |
| tags    | tags of your own: filing, refusing, one spelling, filtering and stacking, the search, Tags... and New tag... on the screen, the panel, details, Filter by |
| states  | save states before a launch: RetroArch's real folder read, the screenshot, a dry launch with a slot, the picker (launch stubbed: RetroArch never opens) |
| screens | every window open and shut (details, menus, editors, Settings, the log, the mailbox, the funnel, the column picker, the screensaver) and exactly what is up after each; the window rules in lib.js are also checked in every other group |
| settings | the Settings screen: the categories, folding, find a setting, the guardrails and sliders, the volume corner's two bars, and Controls (In games by pressing a stand-in pad; RetroArch hotkeys read from its own settings; the menu and quit choices kept, pressed on the stand-in pad, carried by a dry launch and taken away again) |
| runcheck | Emulators > Runs check: the API by dry runs and hand-written results, the panel, Play refused while it runs, and bin/runcheck.ps1 against a stand-in RetroArch (tests/fake-retroarch.js) with the play history proved untouched, and a first start too slow to answer tried once more. The other emulators' commands from made-up emulator folders, and the runner against a stand-in emulator (tests/fake-emulator.cs, built during the run: a small window off the screen). Never starts a real game |
| cores   | Xsegon's own emulator table, the Emulators screen behind it, and the core chosen for one game |
| saves   | the Saves tab of a game's details: RetroArch's states and in-game save, another core's, the ones beside the game's file, PCSX2's, on folders the test makes; a zipped game's start naming a temp folder RetroArch can find; RetroArch's command port and temp folder put right in its settings, and only for the run inside LaunchBox |
| cheats  | which of RetroArch's cheat files belongs to a game, reading one in pages, the find, cheats kept per game and carried by a dry launch |
| writes  | saving that cannot lose a file: a damaged file of yours is never written over, disc sets counted, a lookup past its limit stopped and saying so |
| report  | Report a problem: every check stated, the ROM folder check both ways, and the zip read back |
| scan    | Games > Scan for Games against a fixture tree in the temp folder, never the real drive: every shape of game, disc sets, folders, what is refused and why; Get Specific Pictures listing the games first and looking up only the selected ones; new games added by themselves (the look switched off, what it adds and leaves, the mailbox naming the rest once, the least time between looks, never during a game, a file still arriving, more than a hundred at once, and the page looking at its start and when it comes back) |
| deleted | taking games out of the library, and mostly what that refuses: no confirmation, the wrong number, ids that are not games |
| news    | what changed while you were away, and the mailbox, against a snapshot the test writes; errors kept there once per game, the Errors and Info filter, deleting a message, and the strip saying a failure once |
| offline | the server not answering, faked by blocking the status request: one miss says nothing, three bring the screen, and it clears itself |
| setup   | Getting started and Set it all up, Get RetroArch and cores against stand-ins, and What's new; the Setting up list, Skip on the Runs check, a stopped pictures pass tried again and not called a failure meanwhile, and a bar on every line |
| steamvid | Pictures & Videos > Steam trailers, against stand-ins for Steam's store and video server |
| screenscraper | Pictures & Videos > ScreenScraper videos, against a stand-in the group serves itself, and Xsegon's own developer ID from a stand-in website (its file made by tests/ss-seal.php); the person's logins are never copied in |
| skraper | Stage for Skraper on that window (D9): the picked games staged by the helper, Skraper followed open to closed, the check run by itself, restore; against a stand-in helper in the test copy's own fixtures |
| libretro | names and pictures from libretro, against stand-ins laid out like libretro's servers |
| filecheck | the file check: what a game's file really is by its checksum, against stand-in lists and stand-in game files; the closed line in details and Games > Check game files |
| scanpassed | What Scan for Games passed over: a file taken for a game that is here under another file is named and can be added as another version; a cartridge kept as a .bin |
| unpack | Unpack and add: a disc game still in its .zip or .7z looked into, checked (its list of files, then a stand-in for Windows Defender), placed, unpacked and added, against stand-in archives in a games folder of the test's own |
| gamesdb | the Games Database: built, packed, read and updated from a four-game stand-in; several pictures fetched at once |
| bios    | Emulators > BIOS check, against the sandbox's stand-in system folder; and BIOS help: your own files put in place from a folder, the words a failed start carries, the automatic Runs check's message |
| wanted  | Games > Games you do not have: the list, the stars, the exports |
| fanprojects | the Fan projects page: where each project stands (fits, works, another release, some of a set's discs, missing, yours with its version), every disc of a set read from stand-in discs (PBP, M3U, ISO, CUE and BIN), the team's website, GitHub and community opened only from the list, Make from stand-ins of a team's list, patch and GitHub release (the patch's CRC32 checked, the copy in the Hacks folder, in the library tied to its game), Make for a PC version from stand-in GitHub releases (sha256 checked, unpacked into the Ports folder, your game placed or your discs written out of a .pbp, in the Windows list with the team's links), its own emulator pointed at your game, a build with a stand-in compiler, a Riivolution pack with its updates, the card on the consoles screen and the Games menu entry, and every way out (the view switch, Surprise me) leaving one screen up |
| paths   | a path is never typed: Browse and Clear on every folder box, the emulator table, the program of a game of your own |
| boot    | opening on the copy kept last time: kept per build, drawn at once, redrawn only when the answer changed; the page's scripts riding inside it (no script asked for, each still the module its address names, an error naming its file); on the ordinary load, the way back, the start screen's travelling bar on a slow start, the log's line on where a start went, and a page that never starts reloaded once and then saying so |
| box     | what came in the box: a game's documents, the Shelf view, and the cartridge or disc in details |
| letters | jump by letter: Page Up and Page Down and the pad's shoulders going to the next letter of whatever the list is arranged by, the letter on screen, the ends, the wheel, favourites first, Z to A, and four steps where the order has no letters |
| more    | the rest of a long list: the first lot at once and the rest added as it goes, with the first lot set to 100 so this library takes the road a list of 40,000 takes; the server's lots, every view ending whole, the person going first, a list that changes on the way, a random order, and a short list left untouched |
| wired   | the settings that did nothing: the six gone from Settings, and the four that work now (Ask before launching, Confirm with, Show games with no art, Show the platform beside the title) |
| pads    | a controller's own button names: the kind read off the name the browser gives a pad, PlayStation shapes and Nintendo letters in the legend, the notice that says which kind was found with its Change button and Start on the pad, Button names overruling it, the log line for each pad seen, and the Controller check: its picture lighting what is held, a trigger filling, the sticks' knobs, a second controller taking the picture, the pad driving nothing else meanwhile, and the four ways out; and Xsegon's buttons: a job moved onto another button by the pad, the swap that keeps every job on one, kept per kind of controller, the legend and the screens following it, Standard layout, the lines in sections with the bar starting on Close, the ways in from the round X and the section's heading, and a damaged set left unused (stand-in pads, not real ones); the log lines for a controller that presses twice; a window by controller (js/padwin.js): a stand-in window walked with the cross, its switch, dropdown, button, typing box and slider pressed, a list that scrolls by itself, a long text scrolled, the right stick, then the log window and the mailbox |
| jobs    | the corner bars of the background jobs: one bar a job, several at once, Stop where there is one, each ending said once on the strip; on job files the test writes, nothing started |
| videopack | Pictures & Videos > Export Games with No videos and Import Xsegon Video Package: the list, and a package (made by tests/vpack-probe.php) put onto the games, on games the test makes. Groups in private/tests/ (the maker's own parts) join a run where that folder is |
| emumove | Emulators > Move out of LaunchBox: the copy, the table repointed, LaunchBox's folder untouched, the way back, on a LaunchBox folder the test makes |
| emuadd  | Emulators > Add an emulator, with stand-in programs and dry launches: what is known about a program, what adding refuses, the next launch going through it, changing and removing it with the console handed back exactly, Switch and 3DS games made playable by one, and the screen from the menu and from Settings |
| e2e     | one real game in the real RetroArch, twice: both in small windows with the sound off, on a port found at that moment; the dry run's command run straight, muted and windowed by a quieting config of the group's own, with RetroArch's verbose log caught to hear it load the console's button remap; then a real press of Play through the launch lock's named door (`forReal`), the LNCH log line carrying `pads=`, the game's process up, and the seat coming back when it ends. Proves the lock still holds for everyone who does not ask, and that LaunchBox's retroarch.cfg is byte-for-byte as it was. Steps aside when no RetroArch game is reachable (the ROM drive away) and on `--live` |

Every check that changes something puts it back, and the data files a run
can touch are snapshotted first and restored however the run ends. Your
view settings are restored too. A failing group leaves a screenshot in
tests\out.

A check is `check(name, got, want)`: with `want` it compares, without it
the value just has to be truthy. Add a check where a bug was found, so it
stays found.

One trap in that: `want` of `undefined` IS "no want given", so
`check("gone", thing, undefined)` quietly becomes "thing must be truthy"
and can never pass. Write `check("gone", thing === undefined)` instead.

Wait for the thing, not the clock: after a press, `check(name, await
b.until(expr, want), want)`, and `await b.settled()` for the page to stop
moving. Keep a fixed `sleep()` only for a check that something did NOT
happen. `XS_WAITS=1` prints every wait over a second, and `RAN OUT` marks
one that used its whole time.

## If a run goes red, check the ROM drive first

Known and not fixed yet (roadmap I11, doc\TESTING.md has the detail). With
the ROM drive unplugged the run comes back about **829 of 838**, and every
failure is in `news` and `deleted`, the two groups that test what happens
when a game's file is missing. Nothing is broken: with the drive out every
game looks missing, so the sweep reports nothing and the bulk-delete screen
refuses to open, both on purpose.

    curl -s http://127.0.0.1:8099/api/status.php     # checks.romRoot.present

`false` means plug it in and run `node tests\run.js news deleted` again.
