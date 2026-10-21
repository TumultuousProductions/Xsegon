<?php
/**
 * Xsegon - settings: every setting, its default and what the UI draws for it.
 *
 * Defaults are what a fresh copy does with no data\ folder; a missing
 * settings.json is normal. Stored settings are merged over the defaults key by
 * key, so a setting added later needs no migration.
 */
declare(strict_types=1);

require_once __DIR__ . '/boot.php';

/**
 * The order the settings screen lists the categories in: what you change
 * often first, what you set once last. A category missing here shows at the end.
 */
function xs_settings_order(): array
{
    return [
        'sound', 'video', 'controller',        // the three you came here for
        'gamecontrols',                        // and the controls inside games, beside them
        'view', 'feel',                        // how it looks and moves
        'launch', 'emulators',                 // what happens when you press Play
        'library', 'paths',                    // setting up, and where things live
        'window', 'screensaver', 'debug',      // rarely, and once
    ];
}

/** Put a per-category array into that order, with any stranger left at the end. */
function xs_settings_sort(array $byGroup): array
{
    $out = [];
    foreach (xs_settings_order() as $group) {
        if (array_key_exists($group, $byGroup)) {
            $out[$group] = $byGroup[$group];
        }
    }
    foreach ($byGroup as $group => $value) {
        if (!array_key_exists($group, $out)) {
            $out[$group] = $value;
        }
    }
    return $out;
}

function xs_settings_defaults(): array
{
    return [
        'paths' => [
            /* A new copy starts with neither: LaunchBox is read only when its
               library is brought in, and no ROM drive is set until one is chosen. */
            'launchbox'   => '',
            'romRoot'     => '',
            /* More places Scan for Games walks after the ROM drive. Written by
               the folder list on the Add screen. */
            'scanFolders' => [],
            // blank = the folder Steam wrote into the registry (includes\steam.php)
            'steam'       => '',
            'mediaDir'    => '',           // blank = <project>\data\media: a picture copy, read where present
            // blank = <project>\data\backups; another disk also survives a dead drive
            'backupDir'   => '',
        ],

        'library' => [
            'platforms'        => [],      // [] = every platform LaunchBox lists
            'importOnStartup'  => false,   // re-read when timestamps moved
            // A `copyAfterImport` key in settings.json is ignored: nothing reads it.
            'seedPlayHistory'  => true,    // take PlayCount/PlayTime once, then never again
            'includeHidden'    => false,   // LaunchBox <Hide>
            'includeBroken'    => false,   // LaunchBox <Broken>
            // Where Fill in scanned games looks: gamesdb (the shipped copy) | libretro,
            // which is also used when that copy is missing (api\fill.php).
            'detailsFrom'      => 'gamesdb',
            // auto: fetch a newer Games Database at most once a day
            // (bin\gamesdb-update.php); manual: only on Check now.
            'gamesdbUpdates'   => 'auto',
            // New games in the games folders come in at start and when the window comes back (includes\newgames.php).
            'addNewGames'      => true,
            // Get Media > Get Everything, with a ScreenScraper account: where each kind comes from
            // (includes\getall.php). free-ss: the free sources, then ScreenScraper for the rest | free | ss.
            'getPictures'      => 'free-ss',
            'getVideos'        => 'free-ss',
            'getManuals'       => 'free-ss',
            // The Media tab's compare, Look in (includes\mediachoice.php): each group's places in the person's
            // order, and the ones turned off as "group:place". A set, so Settings draws no row for it.
            'look'             => ['pictures' => ['steam', 'gamesdb', 'ss', 'libretro'], 'videos' => ['steam', 'arcadedb', 'archive', 'ss'],
                                   'manuals' => ['archive', 'ss'], 'off' => []],
        ],

        'view' => [
            'default'             => 'list',   // list | grid | shelf | wheel | carousel | rows; a new copy opens on List, its menu bar in sight
            'systemsFirst'        => true,     // pick a system before seeing games
            'systemsStyle'        => 'wheel',  // wheel | carousel
            'sort'                => 'title',  // title | developer | ... | random, and one per list column: the schema below has them all
            'sortReverse'         => false,    // flip whichever way that sort naturally runs
            'groupHeaders'        => false,    // list and grid: a header wherever the sorted value changes
            'rollVersions'        => true,     // versions of one game on one console share a card (api\library.php)
            'addedPeriod'         => 'month',  // how far back Recently added looks: today | threedays | week | twoweeks | month | year
            'changedPeriod'       => 'week',   // and Recently changed (includes\changed.php), the same choices
            'gridImage'           => 'box',    // which art the grid's tiles show (the Image Group menu)
            // Tile, spine and picture sizes in percent; each view's gear writes its own (js\viewsize.js).
            'gridSize'            => 100,
            'shelfSize'           => 100,
            'rowsSize'            => 100,
            'heroPanel'           => true,     // the info panel beside the list
            'favouritesFirst'     => true,
            'showMissingArt'      => true,     // off: api\library.php leaves out games with no box picture
            'showPlatformInTitle' => false,    // the console after a card's title, where consoles are mixed (js\util.js)
            // The most the library sends at once. Kept high: a cut that silently
            // hides games is worse than a longer list to draw.
            'pageSize'            => 2000,
            // The list view's columns in table order; Title is always drawn. The column headers' menu writes it.
            'listColumns'         => ['title', 'platform', 'genre', 'seconds'],
            // Dragged column widths in pixels, only the changed ones, so a new
            // column arrives at its shipped width.
            'listWidths'          => [],
            // The small marks a game can wear, each a switch on the Badges menu.
            // The no-video mark is video.markMissing.
            'badges'              => ['favourite' => true, 'recent' => false, 'unplayed' => false,
                                      'dead' => true, 'edited' => false, 'docs' => false,
                                      'discs' => true, 'onedisc' => true],
            // The Badges menu's first entry: off draws none, and each keeps its own setting.
            'showBadges'          => true,
            // The consoles down the left of the list and the grid, in place of the
            // platform dropdown. The wheel and the carousel keep their dropdown.
            'sidebar'             => true,
            // Whose console pictures come first (api\image.php): 'yours' (data\platform-art)
            // or 'xsegon' (img\consoles, img\console-photos). Only what is served changes.
            'consoleArt'          => 'yours',
            // How many can play: under the title in the carousel, top right in the wheel.
            'showPlayers'         => false,
            // The list: every other row a shade apart. The gear on the list's strip writes it.
            'listStripes'         => false,
        ],

        'launch' => [
            'checkRomRoot'      => true,   // the guardrail: one check, not one per game
            /* A leftover `checkGameFile` is not read forward: its stored false was
               never a choice, and would keep sweepFiles off. The sweep is quick. */
            'sweepFiles'        => true,   // notice deleted game files on startup
            'confirmBeforeLaunch' => false,    // Play asks "Play this game?" first (js\launch.js)
            'logLaunches'       => true,

            // Come back to the front when the game exits (ALT + AttachThreadInput, bin\launch.ps1).
            'restoreFocus'      => true,
            'focusTitle'        => 'Xsegon',
            // Minimise Xsegon and hand the game the keyboard once its window
            // is up: started from behind the server, a game could open with
            // the keyboard still in Xsegon (bin\launch.ps1, STEPPING ASIDE).
            'stepAside'         => true,

            // Needs RetroArch's network commands; the UI reads the real value
            // from retroarch.cfg. This only says whether Xsegon offers the button.
            'offerQuitButton'   => true,   // needs network_cmd_enable = "true"
            // "Finished X, 12 min" for a few seconds after a game; its "Don't show again" turns this off.
            'showFinished'      => true,

            // A RetroArch game's saved states shown before it starts; the pick
            // sets the slot RetroArch opens on (includes\states.php).
            'offerStates'       => true,
            // How a picked save is loaded when RetroArch's network commands are
            // off: ask, session (on for Xsegon's launches only) or key (the
            // person presses RetroArch's load key). includes\states.php.
            'stateLoad'         => 'ask',
        ],

        'feel' => [
            // The look: 'xsegon' is the house look, any other a file in themes\ (includes\themes.php).
            'theme'        => 'xsegon',
            'animations'   => true,
            'scanlines'    => true,        // the console look, and it is a toggle
            'glow'         => true,

            // accent repaints every highlight (the rules, the selection bar, the glow).
            'accent'       => 'cyan',      // cyan | magenta | amber | green
            // In pixels: the settings' row names, and every menu word grows with it
            // (css --fs is this over 16). An older word value is read forward in xs_settings().
            'textSize'     => 19,          // 12 to 28
            // How bright the white and near-white text is, in percent; greyer text is left as it is.
            'textBrightness' => 100,       // 60 to 100
            // Everything at once, pictures and video included: a veil of
            // black over the whole window. For a bright TV in a dark room.
            'brightness'     => 100,       // 40 to 100

            // The selected game's art behind everything, a legend of the buttons, and a clock.
            'liveBackdrop' => true,
            'helpBar'      => true,
            'clock'        => false,

            // The status strip under the masthead: diagnostics, brought out by the (i) beside the logo.
            'statusBar'    => false,
            // Your name on the window's title and the phone, in letters at the top left with no picture (includes\brand.php).
            'brandName'    => '',

            // For a TV across a room: white ink, near-opaque secondary text,
            // visible borders, no scanline wash, slightly larger type.
            'highContrast' => false,
            // The list's rows far off screen are not drawn until you scroll
            // near them (css body.draw-near, content-visibility). Off draws every row.
            'drawNearOnly' => true,
            // The opening screen is drawn from the copy kept when Xsegon
            // last opened, while the library is read (js/bootcopy.js).
            'openFromLast' => true,
            // A tip put away for good is true here and never shown again (js\logotip.js).
            'tipsGone'     => ['logoMenu' => false],
        ],

        /* Sound in two halves: the app's own noises and a video snap's sound.
           An older file with them under feel and video is read forward in xs_settings(). */
        'sound' => [
            // The app's own noises
            'sounds'       => true,
            // 0-100 on a curve: loudness is (level/100) squared, so the low
            // end has room. The X bar in the corner writes this.
            'volume'       => 70,
            // The built-in set (sounds\Xsegon), which every copy has.
            'soundSet'     => 'Xsegon',
            // Where the Back sound comes from, for a pack that is right except
            // for that one noise: '' = the pack's own, 'select' = reuse the
            // pack's Select, or the name of any other pack to borrow its Back.
            'backSound'    => '',
            // The Hover sound as the pointer passes from game to game, in
            // every view (js\sound.js).
            'hoverSound'   => true,
            // How many of them a second, at most. 30, the slider's top, is no limit.
            'hoverRate'    => 9,

            // A video snap's sound
            'videoSound'   => true,        // whether a snap is allowed to make noise at all
            // A level of its own: a snap as loud as the menu blips is far too loud. Mute silences both.
            'videoVolume'  => 75,          // the same curve; the film bar writes this
        ],

        // Video snaps. The cover is what you see while moving; rest on a game
        // and after delaySec its snap takes the cover's place, until you move.
        // Whether it makes a noise is in 'sound', with every other noise.
        'video' => [
            'enabled'      => true,
            'delaySec'     => 2,           // how long to rest on a game first
            'inBrowse'     => true,        // where the artwork is, while choosing
            'inDetails'    => true,        // where the cover is, in details
            'loop'         => true,
            'markMissing'  => true,        // a small mark on games that have no snap
            'ssManuals'    => true,        // ScreenScraper videos fetches manuals too, for games the online archives could not fill
        ],

        /* The pad, and the mouse and keyboard. Keyed 'controller' because that
           is where existing files store the pad settings. */
        'controller' => [
            // The pad
            'enabled'       => true,
            'confirmButton' => 'a',        // A confirms and B backs out, or the other way round (js\input.js)
            'buttonNames'   => 'auto',     // whose button names the legend shows: the pad's own, or one chosen (js\padkind.js)
            'padJobs'       => [],         // your own buttons for Xsegon's screens, per kind of controller (js\padjobs.js)
            'deadzone'      => 0.35,
            'repeatDelayMs' => 400,
            'repeatRateMs'  => 110,
            // Some PCs have a sensor that reports as a pad; the UI ignores pads with no buttons.
            'ignoreEmptyPads' => true,
            // A pad the browser does not know is read through the list SDL programs share (js\padlist.js).
            'sharedPadList'   => true,

            // The mouse and the keyboard
            'wheelTurns'     => true,      // the scroll wheel turns the rim and the carousel
            'wheelSpeed'     => 5,         // how far a notch turns it: 5 is one game (js\wheelscroll.js)
            'wheelGlide'     => 4,         // how long a quick flick keeps it turning: 0 stops dead
            'wheelAccel'     => 5,         // how much more a notch turns it the faster you spin: 0 never more
            'dragSpins'      => true,      // grab the rim and pull it round
            'clickChosen'    => 'details', // what a click on the ALREADY chosen game does
            'hidePointer'    => true,      // a pointer sitting on a TV is a smudge
            'hidePointerSec' => 3,
            'arrowsWrap'     => false,     // past the last game, back to the first
        ],

        /* confirmClose: a panel's Close sits almost in line with the window's X,
           and the question leaves a log line, so a window that vanishes without one
           was not closed from there. */
        'window' => [
            'confirmClose' => true,
            'phoneStays'    => 'on',       // how long the phone page stays open once switched on (includes\phone.php)
            'fillBigScreen' => true,       // read when the window is started (bin\xsbrowser.ps1); the page only asks when its screen changes
            'tellNewVersions' => true,     // a daily look for a newer release, said once in the mailbox (includes\newversion.php)
            'getNewVersions'  => false,    // a newer one downloaded and checked as soon as it is out; off, only when Update now is pressed
        ],

        // What the screen does when nobody touches it.
        'screensaver' => [
            'enabled'  => true,
            'afterMin' => 5,
            'everySec' => 12,
            'mode'     => 'art',           // art | clock
        ],

        'debug' => [
            'logging'          => true,    // data\log\<day>.log: every action, page and server
            'logMoves'         => true,    // also every settled selection (SEL), the noisiest line
            'asked'            => ['logging' => false],   // the "Keep a log?" card was answered (js\logask.js)
        ],
        /* Built from data\emulators.json, not from keys here; the entry is
           there because the settings screen draws one page per category. */
        'emulators' => [],
        /* The same: built by js\padmap.js and js\rahotkeys.js from RetroArch's
           files and Xsegon's remaps. */
        'gamecontrols' => [],
    ];
}

/**
 * What each setting is, so the UI draws a real control and a setting with a
 * known set of answers is never typed. A key with no entry falls back to the
 * type of its default.
 */
function xs_settings_schema(): array
{
    $ways = ['free-ss' => 'Free sources, then ScreenScraper', 'free' => 'Free sources only', 'ss' => 'ScreenScraper only'];
    return [
        /* 'section' puts a row in a named, foldable box on its page (js/settings-ui.js),
           in the order of their first row or of '_sections'. A row with none goes in an unnamed box. */
        'paths' => [
            '_label' => 'Paths',
            '_help'  => 'Where your things live. Xsegon only ever reads these.',
            'launchbox' => ['label' => 'LaunchBox folder', 'type' => 'path', 'lb' => 'off', 'section' => 'Where your games are',
                            'help' => 'Where a LaunchBox library was brought in from (Games > Bring in a LaunchBox library). Only its list of games and your own play data are read from here, and nothing is written or copied.'],
            'romRoot'   => ['label' => 'ROM drive', 'type' => 'path', 'section' => 'Where your games are',
                            'help' => 'Checked once at launch. If it is missing, the whole screen says so.'],
            'steam'     => ['label' => 'Steam folder', 'type' => 'path', 'section' => 'Where your games are',
                            'help' => 'Where Steam is installed, for Games > Add Steam games. Blank means Xsegon finds it by itself. Only ever read.'],
            // No row: nothing fills the folder. A file that names one is still honoured (includes\media.php).
            'mediaDir'  => ['type' => 'set'],
            // Owned by the folder list in Scan for Games; with no entry it is drawn as a text box.
            'scanFolders' => ['type' => 'set'],
            'backupDir' => ['label' => 'Backup folder', 'type' => 'path', 'section' => "Xsegon's own folders",
                            'help' => 'Where Settings > Library > Backup writes its archives. Blank means data\\backups inside Xsegon, which is better than nothing and worse than another drive: a backup kept inside the folder it is backing up goes with it if the disk does.'],
        ],
        /* 'lb' => 'hide': left out when no LaunchBox is in use; 'off': left out only
           when the folder is set to nothing. helpNoLb and _helpNoLb are the words without it. */
        'library' => [
            '_label' => 'Library',
            '_help'  => 'What gets imported from LaunchBox, and when.',
            '_helpNoLb' => 'Your games and the pictures Xsegon keeps for them.',
            // The page's buttons are put in these sections by js/settings-ui.js.
            'platforms'       => ['label' => 'Platforms', 'type' => 'list', 'lb' => 'hide', 'section' => 'Importing from LaunchBox',
                                  'help' => 'Blank means every platform LaunchBox lists.'],
            'importOnStartup' => ['label' => 'Re-read on startup', 'lb' => 'hide', 'section' => 'Importing from LaunchBox', 'help' => 'Only when LaunchBox files have changed.'],
            'seedPlayHistory' => ['label' => 'Seed history from LaunchBox', 'lb' => 'hide', 'section' => 'Importing from LaunchBox', 'help' => 'Once, on first import. Never again.'],
            'includeHidden'   => ['label' => 'Include hidden games', 'section' => 'Which games'],
            'includeBroken'   => ['label' => 'Include broken games', 'section' => 'Which games'],
            'detailsFrom'     => ['label' => 'Names, details and pictures from', 'type' => 'enum', 'section' => 'Names, details and pictures',
                                  'options' => ['gamesdb' => 'LaunchBox Games Database', 'libretro' => 'libretro'],
                                  'help' => 'Where Get Pictures and Get Specific Pictures look. The LaunchBox Games Database has descriptions, ratings and the most pictures, and a copy of it comes with Xsegon. libretro has names, a few details and pictures, but no descriptions.'],
            'gamesdbUpdates'  => ['label' => 'Games Database updates', 'type' => 'enum', 'section' => 'Names, details and pictures',
                                  'options' => ['auto' => 'Automatic', 'manual' => 'Manual'],
                                  'help' => 'Automatic: once a day at most, Xsegon checks for a newer copy of the LaunchBox Games Database and fetches it in the background (about 70 MB). Manual: only when you press Check now, below.'],
            'addNewGames'     => ['label' => 'Add new games by themselves', 'section' => 'New games',
                                  'help' => 'When Xsegon starts, and when you come back to it, it looks in your games folders and adds the new games it is sure of, at most once a minute and never while a game is running. The ones it is not sure of wait for Games > Scan for Games.'],
            'getPictures'     => ['label' => 'Pictures from', 'type' => 'enum', 'section' => 'Get everything missing', 'options' => $ways,
                                  'help' => 'Get Media > Get Everything, when a ScreenScraper account is signed in. The free sources are where Get Pictures looks (Names, details and pictures from, above). Then ScreenScraper fetches covers only for the games they could not fill, which keeps your daily allowance. Without an account, the free sources alone. Set in that window too.'],
            'getVideos'       => ['label' => 'Videos from', 'type' => 'enum', 'section' => 'Get everything missing', 'options' => $ways,
                                  'help' => 'The free sources are Steam trailers and Videos from online archives. Then ScreenScraper fetches videos only for the games they could not fill. Without an account, the free sources alone.'],
            'getManuals'      => ['label' => 'Manuals from', 'type' => 'enum', 'section' => 'Get everything missing', 'options' => $ways,
                                  'help' => 'The free source is Manuals from online archives. Then ScreenScraper fetches manuals only for the games it could not fill. Without an account, the free source alone.'],
        ],
        'view' => [
            '_label' => 'View',
            '_help'  => 'How the wall is laid out. All of it changeable, all of it remembered.',
            'default' => ['label' => 'Game view', 'type' => 'enum', 'section' => 'Views',
                          'options' => ['list' => 'List', 'grid' => 'Grid', 'shelf' => 'Shelf',
                                        'wheel' => 'Wheel', 'carousel' => 'Carousel', 'rows' => 'Rows'],
                          'help' => 'How the games are shown, and what Xsegon opens on: List, Grid, Shelf and Rows open on every game (Shelf: the games standing side by side by the side of their boxes, as on a shelf; Rows: the chosen game across the top, then rows of Continue playing, Favourites, Recently added and one per genre); Wheel and Carousel open on the consoles first when "Systems first" is on. The dropdown in the masthead always names what is on screen.'],
            'systemsFirst' => ['label' => 'Systems first', 'section' => 'Views',
                               'help' => 'Pick a system before seeing its games, the way Batocera opens. For the Wheel and the Carousel: List and Grid have no shape on the consoles screen, so they open on every game with the consoles one press away (Esc). Off shows everything at once.'],
            'systemsStyle' => ['label' => 'Systems screen style', 'type' => 'enum', 'section' => 'Views',
                               'options' => ['wheel' => 'Wheel of banners', 'carousel' => 'Console gallery'],
                               'help' => 'Wheel: platform banners on the rim. Gallery: the console itself over its scenery.'],
            'sort'    => ['label' => 'Sort by', 'type' => 'enum', 'section' => 'Order and grouping',
                          'options' => ['title' => 'Title', 'developer' => 'Developer',
                                        'publisher' => 'Publisher', 'genre' => 'Genre',
                                        'platform' => 'Platform', 'year' => 'Release date',
                                        'rating' => 'Rating', 'myrating' => 'Your rating',
                                        'plays' => 'Play count',
                                        'playtime' => 'Most played', 'recent' => 'Recently played',
                                        'random' => 'Random',
                                        // The rest of the list's columns, set by a press on their headers.
                                        'players' => 'Players', 'added' => 'Date added', 'favourite' => 'Favourite',
                                        'tags' => 'Tags', 'cheats' => 'Cheats', 'missing' => 'Missing art',
                                        'ready' => 'Ready', 'needsfix' => 'Needs fix', 'source' => 'Source',
                                        'file' => 'File', 'docs' => 'Documents', 'hack' => 'Hack', 'discs' => 'Discs'],
                          'help' => 'Also the Arrange By menu in list and grid, and a press on any of the list\'s column headers.'],
            'sortReverse'  => ['label' => 'Reverse the order', 'section' => 'Order and grouping',
                               'help' => 'Flips whichever way that sort naturally runs (Z to A, worst rated first).'],
            'rollVersions' => ['label' => 'One card per game', 'section' => 'Order and grouping',
                               'help'  => 'Versions of one game on one console (USA and Europe, a revision, a fan translation) share a card, marked with a stack of cards and a count; point at the mark to see them, and Play asks which one. Off shows every file as a game of its own, each with the words that tell it apart.'],
            'groupHeaders' => ['label' => 'Group under headers', 'section' => 'Order and grouping',
                               'help' => 'List and grid: a header wherever the arranged-by value changes.'],
            'addedPeriod'  => ['label' => 'Recently added goes back', 'type' => 'enum', 'section' => 'Order and grouping',
                               'options' => ['today' => 'Today', 'threedays' => 'Past 3 days', 'week' => 'Past week',
                                             'twoweeks' => 'Past 2 weeks', 'month' => 'Past month', 'year' => 'Past year'],
                               'help' => 'How far back the Recently added collection looks, and the Recently added row in the Rows view. Also the dropdown in the bar while Recently added is open, and its menu on the consoles screen (right-click, or Y on the pad).'],
            'changedPeriod' => ['label' => 'Recently changed goes back', 'type' => 'enum', 'section' => 'Order and grouping',
                               'options' => ['today' => 'Today', 'threedays' => 'Past 3 days', 'week' => 'Past week',
                                             'twoweeks' => 'Past 2 weeks', 'month' => 'Past month', 'year' => 'Past year'],
                               'help' => 'How far back the Recently changed collection looks: the games whose pictures, video or details came or changed, by your hand or by a fetch. Also the dropdown in the bar while Recently changed is open, and its menu on the consoles screen (right-click, or Y on the pad).'],
            'gridImage' => ['label' => 'Grid image', 'type' => 'enum', 'section' => 'What is shown',
                            'options' => ['box' => 'Box art', 'box3d' => '3D box', 'logo' => 'Clear logo',
                                          'shot' => 'Screenshot', 'fanart' => 'Fanart', 'medium' => 'Cartridge or disc'],
                            'help' => 'Which art the grid tiles show. Also the Image Group menu. A game without that art falls back to its box. Cartridge or disc shows what the game is played from: the pictures in data\\extras\\cart and data\\extras\\disc.'],
            'gridSize'  => ['label' => 'Grid tile size', 'type' => 'range', 'min' => 50, 'max' => 250, 'step' => 10, 'unit' => '%',
                            'section' => 'What is shown',
                            'help' => 'How big the grid draws its tiles, as a percentage of the usual size: smaller shows more games at once, larger shows more of each picture. Also the gear at the right of the strip over the grid, and View > Tile size.'],
            'shelfSize' => ['label' => 'Shelf size', 'type' => 'range', 'min' => 50, 'max' => 200, 'step' => 10, 'unit' => '%',
                            'section' => 'What is shown',
                            'help' => 'How tall the Shelf view stands its games, as a percentage of the usual height. Also the gear at the right of the strip over the shelf, and View > Shelf size.'],
            'rowsSize'  => ['label' => 'Rows picture size', 'type' => 'range', 'min' => 50, 'max' => 150, 'step' => 10, 'unit' => '%',
                            'section' => 'What is shown',
                            'help' => 'How big the Rows view draws the pictures in its rows, as a percentage of the usual size: smaller shows more games and more rows at once. Also the gear in the top right corner of the Rows view, and View > Picture size.'],
            // Owned by their own menus. No settings row can show one: drawing the
            // widths as a list stops Settings opening.
            'listWidths' => ['type' => 'set'],
            'badges'     => ['type' => 'set'],
            // Owned by the column picker; as a text box it would save a list as a string.
            'listColumns' => ['type' => 'set'],
            'showBadges'  => ['label' => 'Badges on games', 'section' => 'What is shown',
                              'help'  => 'The small marks on games: favourite, no video, never played and the rest. Off, none is drawn, and each keeps its own setting. Also the first entry of the Badges menu; which marks are drawn is chosen there.'],
            'showPlayers' => ['label' => 'Player icons on games', 'section' => 'What is shown',
                              'help'  => 'How many can play, as figures (one red: single player, two green: more): under the title in the carousel, and at the top right of each game in the wheel. Games nobody gave a player count show nothing. Clicking the figures offers to turn them off; this is how to bring them back. Also Badges > Player icons.'],
            'listStripes' => ['label' => 'Striped rows in the list', 'section' => 'What is shown',
                              'help'  => 'List only: every other row a shade apart, so the eye can follow a wide table across from a title to a far column. Also the gear at the right of the strip over the list, and View > Striped rows.'],
            'sidebar' => ['label' => 'Platform sidebar', 'section' => 'What is shown',
                           'help'  => 'List and grid only: the consoles down the left, each with its icon, in place of the platform dropdown. Also View > Platform sidebar.'],
            'consoleArt' => ['label' => 'Console pictures', 'type' => 'enum', 'section' => 'What is shown',
                             'options' => ['yours' => 'Yours first', 'xsegon' => "Xsegon's own"],
                             'help' => "Which pictures the consoles wear in the sidebar, the console picker, the wheel's middle and its name logos, and the carousel. Yours first: the ones you chose (right-click a console > Change Pictures), then Xsegon's own for a console with none. Xsegon's own: the console photos, icons and name logos that come with Xsegon, in front of yours. Yours are kept as they are, and Yours first brings them back."],
            'heroPanel' => ['label' => 'Info panel beside the list', 'section' => 'What is shown',
                                      'help' => 'Box art, rating and play history for the selected game.'],
            'favouritesFirst'     => ['label' => 'Favourites first', 'section' => 'Order and grouping'],
            'showMissingArt'      => ['label' => 'Show games with no art', 'section' => 'What is shown',
                                      'help' => 'Off leaves a game with no box picture out of every view and every count until it has one. Get Media > Get Pictures still finds it.'],
            'showPlatformInTitle' => ['label' => 'Show the platform beside the title', 'section' => 'What is shown',
                                      'help' => 'The console after each title on the cards of the Grid, the Carousel and the Rows view, where the games on screen are from more than one console: every game, a collection or a search. Not inside a single console.'],
            'pageSize'            => ['label' => 'Games shown at once', 'type' => 'number', 'min' => 25, 'max' => 2000, 'section' => 'What is shown',
                                      'help' => 'How many games of a list are drawn the moment it opens. A longer list gets the rest as you go, a piece at a time between your presses, with a bar in the corner until all are in.'],
        ],
        'launch' => [
            '_label' => 'Launching',
            '_help'  => 'What happens when you press A.',
            '_sections' => ['Before a game starts', 'While it plays', 'When it ends'],
            'checkRomRoot'        => ['label' => 'Check the ROM drive first', 'section' => 'Before a game starts', 'help' => 'One check instead of one per game.'],
            'sweepFiles'          => ['label' => 'Check each game file on startup', 'section' => 'Before a game starts', 'help' => 'Notices games whose file has been deleted, before you press play.'],
            'confirmBeforeLaunch' => ['label' => 'Ask before launching', 'section' => 'Before a game starts',
                                      'help' => 'Play asks "Play this game?" first, so a stray Enter or A starts nothing. A game with save states to choose from asks with those instead.'],
            'logLaunches'         => ['label' => 'Log every launch', 'section' => 'While it plays'],
            'restoreFocus'        => ['label' => 'Come back after a game', 'section' => 'When it ends', 'help' => 'Pulls Xsegon to the front when the game exits.'],
            'focusTitle'          => ['label' => 'Window title to return to', 'section' => 'When it ends'],
            'stepAside'           => ['label' => 'Step aside while a game plays', 'section' => 'While it plays',
                                      'help' => 'Minimises Xsegon once the game\'s window is up and gives the game the keyboard. Xsegon comes back when the game ends.'],
            'showFinished'        => ['label' => 'Say when a game finishes', 'section' => 'When it ends',
                                      'help' => 'A few seconds of "Finished", with the time played, when you come back from a game.'],
            'offerQuitButton'     => ['label' => 'Offer a Stop Game button', 'section' => 'While it plays',
                                      'help' => 'Needs network_cmd_enable = "true" in retroarch.cfg.'],
            'stateLoad'           => ['label' => 'Loading a save you picked', 'type' => 'enum', 'section' => 'Before a game starts',
                                      'options' => ['ask' => 'Ask me the first time',
                                                    'session' => "Turn RetroArch's network commands on for Xsegon's games",
                                                    'key' => 'Leave it to me: I press the load key'],
                                      'help' => "Only when Network Commands are off in RetroArch (Settings > Network). With them on, Xsegon always loads the save itself. Turning them on for Xsegon's games means settings changed inside RetroArch during those games are not saved."],
            'offerStates'         => ['label' => 'Offer your save states before a launch', 'section' => 'Before a game starts',
                                      'help' => 'A RetroArch game with saves shows them first; the pick is the slot RetroArch opens on.'],
        ],
        'sound' => [
            '_label' => 'Sound',
            '_help'  => 'Every noise Xsegon makes, in two halves: what the app does as you move around it, and what comes out of a video snap.',
            'sounds'      => ['label' => 'Sounds for what you do', 'section' => 'In the app',
                              'help' => 'Move, select, back. Off makes the interface silent; a snap can still have sound.'],
            'volume'      => ['label' => 'Volume', 'type' => 'range', 'min' => 0, 'max' => 100, 'step' => 1,
                              'section' => 'In the app',
                              'help' => 'Also the X bar under the speaker at the bottom right, and the - and + keys.'],
            'soundSet'    => ['label' => 'Sound set', 'type' => 'enum', 'options' => 'soundSets', 'section' => 'In the app',
                              'help' => 'Xsegon\'s own two sets, or a pack of your own in Xsegon\'s data\\sounds folder. Choosing one plays it.'],
            'backSound'   => ['label' => 'Back sound', 'type' => 'enum', 'options' => 'backSounds', 'section' => 'In the app',
                              'help' => 'For a pack that is right except for its Back noise: borrow that one from another pack, or reuse its own Select.'],
            'hoverSound'  => ['label' => 'Sound under the pointer', 'section' => 'In the app',
                              'help' => 'Each game the pointer passes over makes the Hover sound, and so does each button, menu entry and tab: yours (Your own sounds, below), or the sound set\'s, or the built-in one where the set has none. Off keeps the sound for the arrow keys, the pad and a click.'],
            // 'top': what the slider says at its far right, in place of the number.
            'hoverRate'   => ['label' => 'Sounds under the pointer, at most', 'type' => 'range', 'min' => 1, 'max' => 30, 'step' => 1,
                              'unit' => 'a second', 'top' => 'no limit', 'section' => 'In the app',
                              'help' => 'How many games or buttons a second sound as the pointer sweeps over them. One crossed sooner than that is passed in silence, and the one the pointer stays on is always heard. All the way right is no limit. Letting go of the slider plays a sweep that fast.'],
            'videoSound'  => ['label' => 'Sound from video snaps', 'section' => 'Video snaps',
                              'help' => 'Off plays every snap silent. The small speaker at the corner of a playing snap does the same for one game.'],
            'videoVolume' => ['label' => 'Snap volume', 'type' => 'range', 'min' => 0, 'max' => 100, 'step' => 1,
                              'section' => 'Video snaps',
                              'help' => 'A level of its own, apart from the sounds above. Also the film bar under the speaker at the bottom right. Mute silences both.'],
        ],
        'feel' => [
            '_label' => 'Feel',
            '_help'  => 'The costume. None of it changes what the app does.',
            '_sections' => ['Text and brightness', 'Colour and effects', 'On screen', 'Speed', 'Your name and logo', 'Your own look'],
            // Its choices are the files in themes\ (api\settings.php fills them in).
            'theme'        => ['label' => 'Theme', 'type' => 'enum', 'options' => 'themes', 'section' => 'Colour and effects',
                               'help' => 'The colours of everything. Xsegon is the look it comes with, and is always here to go back to. Also in the round X menu.'],
            'animations'   => ['label' => 'Animations', 'section' => 'Colour and effects'],
            'scanlines'    => ['label' => 'Scanlines', 'section' => 'Colour and effects',
                               'help' => 'Fine lines across the background, like an old screen. Part of the Xsegon theme: a theme without them leaves them off.'],
            'glow'         => ['label' => 'Glow', 'section' => 'Colour and effects',
                               'help' => 'The light round whatever is chosen. Part of the Xsegon theme: a theme without it leaves it off.'],
            'accent'       => ['label' => 'Accent colour', 'type' => 'enum', 'section' => 'Colour and effects',
                               'options' => ['cyan' => 'Cyan', 'magenta' => 'Magenta',
                                             'amber' => 'Amber', 'green' => 'Green'],
                               'help' => 'Every highlight in the app: the rules, the selection bar, the glow. Cyan is the house colour. It belongs to the Xsegon theme: another theme brings its own highlight, and this waits until you are back.'],
            // 'unit' is said after the number beside the slider.
            'textSize'     => ['label' => 'Menu text size', 'type' => 'range', 'min' => 12, 'max' => 28, 'step' => 1, 'unit' => 'px',
                               'section' => 'Text and brightness',
                               'help' => 'The size of these setting names, in pixels; the menus, the list and the button legend grow with them. 16 was Normal and 19 Large. The further away you sit, the bigger this wants to be. Changes as you slide, and is saved where you leave it.'],
            'brightness'     => ['label' => 'Overall brightness', 'type' => 'range', 'min' => 40, 'max' => 100, 'step' => 5,
                               'section' => 'Text and brightness',
                               'help' => 'Everything on screen at once, pictures and videos too, in percent. Changes as you slide, and is saved where you leave it.'],
            'textBrightness' => ['label' => 'Text brightness', 'type' => 'range', 'min' => 60, 'max' => 100, 'step' => 5,
                               'section' => 'Text and brightness',
                               'help' => 'How bright the whitest words are, in percent. The greyer words stay as they are. Changes as you slide, and is saved where you leave it.'],
            'liveBackdrop' => ['label' => 'Live backdrop', 'section' => 'Colour and effects',
                               'help' => 'The selected game\'s art fills the screen behind everything.'],
            'helpBar'      => ['label' => 'Button legend', 'section' => 'On screen', 'help' => 'The bar at the bottom that says what the keys do.'],
            'clock'        => ['label' => 'Clock', 'section' => 'On screen'],
            'statusBar'    => ['label' => 'Status info bar', 'section' => 'On screen', 'help' => 'The strip under the logo. The (i) beside XSEGON toggles it too.'],
            'highContrast' => ['label' => 'High contrast', 'section' => 'Text and brightness', 'help' => 'For a TV across a room.'],
            'brandName'    => ['label' => 'Your name', 'section' => 'Your name and logo',
                               'help' => 'On the window\'s title, a game\'s window and the phone. With no picture of your own, it stands at the top left in letters. Leave it empty for Xsegon.'],
            'drawNearOnly' => ['label' => 'Draw only what is near the screen', 'section' => 'Speed',
                               'help' => 'The list skips drawing rows far off screen until you scroll near them, which makes a long list quicker to show and to scroll. Turn off if a row ever looks late to appear.'],
            'openFromLast' => ['label' => 'Open on the copy from last time', 'section' => 'Speed',
                               'help' => 'Xsegon keeps what it showed when it last opened and shows that at once while the library is read, then draws again only if something changed. Turn off to always wait for the library.'],
            'tipsGone'     => ['type' => 'set'],
        ],
        'video' => [
            '_label' => 'Video',
            '_help'  => 'Snaps from Xsegon\'s own data\\videos folder. A game with no snap just keeps its cover.',
            'enabled'   => ['label' => 'Play video snaps', 'section' => 'Playing snaps'],
            'delaySec'  => ['label' => 'Wait before playing (seconds)', 'min' => 0, 'max' => 30, 'step' => 0.5, 'section' => 'Playing snaps',
                            'help' => 'How long to rest on a game before its snap replaces the artwork.'],
            'inBrowse'  => ['label' => 'While choosing a game', 'section' => 'Where they play', 'help' => 'The snap takes the place of the artwork until you move.'],
            'inDetails' => ['label' => 'In details', 'section' => 'Where they play', 'help' => 'The snap takes the place of the cover.'],
            'loop'      => ['label' => 'Loop', 'section' => 'Playing snaps', 'help' => 'Off shows the artwork again when the snap ends.'],
            'markMissing' => ['label' => 'Mark games with no video', 'section' => 'Playing snaps',
                              'help' => 'A very small clapperboard on games that have no snap yet.'],
            'ssManuals'   => ['label' => 'Manuals too, with ScreenScraper videos', 'section' => 'Fetching',
                              'help' => 'Get Media > ScreenScraper videos also fetches a manual for each game with none that Manuals from online archives could not fill, in English or the game\'s own language. Set in that window too.'],
        ],
        'controller' => [
            '_label' => 'Xsegon Controls',
            '_help'  => 'Getting around Xsegon itself: its menus, the wheel and the lists. Not used in games.',
            /* Xsegon's own controls only; the controls inside games are the
               next category, gamecontrols. */
            'enabled'        => ['label' => 'Controller navigation', 'section' => 'Xsegon (Gamepad)',
                                  'help' => 'Off ignores every pad on the machine.'],
            'confirmButton'   => ['label' => 'Confirm with', 'type' => 'enum', 'section' => 'Xsegon (Gamepad)',
                                  'options' => ['a' => 'A', 'b' => 'B'],
                                  'help' => 'Which button opens, plays and says yes in Xsegon; the other of the two backs out. By an Xbox pad\'s letters: A is the bottom button of the four (Cross on a PlayStation pad) and B the right one (Circle), which is where Nintendo puts confirm. A kind of controller whose buttons you set yourself (Xsegon\'s buttons, below) keeps its own. Xsegon\'s own screens only: games keep their own buttons.'],
            'buttonNames'     => ['label' => 'Button names', 'type' => 'enum', 'section' => 'Xsegon (Gamepad)',
                                  'options' => ['auto' => 'Automatic', 'xbox' => 'Xbox', 'playstation' => 'PlayStation', 'nintendo' => 'Nintendo', 'position' => 'By position'],
                                  'help' => 'Whose button names Xsegon shows at the foot of the screen. Automatic follows the controller in use. Choose one yourself when a controller is read as another kind: a PlayStation pad used through Steam or a PS3 driver looks like an Xbox pad. Only the names change: every button does what it did.'],
            // Set on the picture of a controller (Xsegon's buttons, js\padcheck.js): no row of its own could show it.
            'padJobs'         => ['type' => 'set'],
            'deadzone'        => ['label' => 'Stick deadzone', 'type' => 'number', 'min' => 0.05, 'max' => 0.9, 'step' => 0.05,
                                  'section' => 'Xsegon (Gamepad)', 'help' => 'How far the stick moves before Xsegon counts it.'],
            'repeatDelayMs'   => ['label' => 'Hold before repeating (ms)', 'type' => 'number', 'min' => 120, 'max' => 1200, 'section' => 'Xsegon (Gamepad)'],
            'repeatRateMs'    => ['label' => 'Repeat every (ms)', 'type' => 'number', 'min' => 40, 'max' => 600, 'section' => 'Xsegon (Gamepad)'],
            'ignoreEmptyPads' => ['label' => 'Ignore phantom controllers', 'section' => 'Xsegon (Gamepad)',
                                  'help' => 'Some PCs have a device (a sensor, wheel pedals) that reports as a gamepad. On skips pads with no buttons.'],
            'sharedPadList'   => ['label' => 'Use the shared controller list', 'section' => 'Xsegon (Gamepad)',
                                  'help' => 'A controller the browser does not know has its buttons in its own order. On looks it up, by its maker and product numbers, in the list of thousands of controllers that most emulators share, and reads it through that. Xsegon\'s own screens only; games read a controller themselves. Off if a controller behaves worse with it.'],

            'wheelTurns'     => ['label' => 'Scroll wheel turns the rim', 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'The consoles rim, the game wheel and the carousel. Off leaves the wheel to the page.'],
            'wheelSpeed'     => ['label' => 'Scroll speed', 'type' => 'range', 'min' => 1, 'max' => 10, 'step' => 1, 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'How far one notch of the scroll wheel turns the wheels and the carousel. 5 is one game a notch; 1 needs two or three notches a game; 10 is three games a notch. Also on the gear at the top left of the game wheel.'],
            'wheelGlide'     => ['label' => 'Scroll momentum', 'type' => 'range', 'min' => 0, 'max' => 10, 'step' => 1, 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'How long the wheel keeps turning after a quick flick, slowing to a stop. 0 stops the moment you stop scrolling. A slow scroll always moves exactly notch by notch, and a notch the other way brakes it. Also on the gear at the top left of the game wheel.'],
            'wheelAccel'     => ['label' => 'Scroll acceleration', 'type' => 'range', 'min' => 0, 'max' => 10, 'step' => 1, 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'The faster you spin the scroll wheel, the more each notch counts, so a hard spin crosses a long list quickly. A slow scroll is never sped up. 5 lets a notch count up to three and a half times at full speed; 10 up to six; 0 turns it off. Also on the gear at the top left of the game wheel.'],
            'dragSpins'      => ['label' => 'Drag to spin', 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'Grab the rim or the carousel and pull it round.'],
            'clickChosen'    => ['label' => 'Clicking the chosen game', 'type' => 'enum', 'section' => 'Xsegon (Mouse and keyboard)',
                                 'options' => ['details' => 'Opens its details', 'play' => 'Plays it', 'nothing' => 'Does nothing'],
                                 'help' => 'The first click always chooses a game. This is what a second one does.'],
            'hidePointer'    => ['label' => 'Hide the pointer when it stops', 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'A mouse pointer parked on a television is a smudge. It comes back the moment you move.'],
            'hidePointerSec' => ['label' => 'Hide it after (seconds)', 'type' => 'number', 'min' => 1, 'max' => 60, 'section' => 'Xsegon (Mouse and keyboard)'],
            'arrowsWrap'     => ['label' => 'Arrows wrap around the ends', 'section' => 'Xsegon (Mouse and keyboard)',
                                 'help' => 'Past the last game, back to the first. Applies to the consoles rim as well.'],
        ],
        'gamecontrols' => [
            '_label' => 'RetroArch + Emulator Controls',
            // Its name on the side list, in two lines: in one it wraps to three.
            '_tab'   => "RetroArch + Emulator\nControls",
            '_help'  => 'The controls inside your games, for the games RetroArch plays: your buttons and keys for each console, and RetroArch\'s hotkeys for leaving, pausing, saving and turbo. Other emulators and Steam games keep their controls in their own settings, and Xsegon does not change those.',
        ],
        'window' => [
            '_label' => 'Window',
            '_help'  => 'The Xsegon window itself.',
            '_sections' => ['Closing Xsegon', 'On a big screen', 'Connecting a phone', 'New versions'],
            'tellNewVersions' => ['label' => 'Tell me when a new version is out', 'section' => 'New versions',
                                  'help' => 'Once a day, when this PC is online, Xsegon asks its page on GitHub which version is the newest, and Messages says once when a newer one is out, with Update now. Nothing of this copy changes until you press it. Off, Xsegon never asks.'],
            'getNewVersions'  => ['label' => 'Download new versions by themselves', 'section' => 'New versions',
                                  'help' => 'A newer version is downloaded in the background as soon as Xsegon hears of it (about 7 MB), checked against the list its maker signed and tried once on its own, so Update now takes only a moment. Off, nothing is downloaded until you press Update now. Either way nothing of this copy changes until you press it. Update now asks this too.'],
            'phoneStays'   => ['label' => 'Phone page stays open', 'type' => 'enum', 'section' => 'Connecting a phone',
                               'options' => ['on' => 'Until I switch it off', 'close' => 'Until Xsegon closes', 'idle' => 'Off by itself when no phone uses it'],
                               'help' => 'The phone page lets a phone on the home Wi-Fi browse your games and start one on this PC. It is closed until you switch it on in the round X\'s menu, under Connect a phone... This says how long it then stays open: until you switch it off, also after Xsegon is closed and opened again; until Xsegon closes; or until no phone has asked anything for 30 minutes. Closed, nothing on this PC is open to the home network.'],
            'confirmClose' => ['label' => 'Ask before closing Xsegon', 'section' => 'Closing Xsegon',
                               'help' => 'The X in the corner asks first. Worth leaving on: it sits almost in line with the Close button of whatever panel is open, and the question is written to the log, so a window that disappears without one was not closed from here.'],
            'fillBigScreen' => ['label' => 'Fill a big screen', 'section' => 'On a big screen',
                                'help' => 'On a screen bigger than 1920 x 1200 (a 1440p or 4K monitor) everything is drawn larger, so Xsegon looks as it does on a 1920 x 1200 screen and not small in the middle. Never smaller than Windows\' own scaling. Off, everything is the size Windows gives it. A smaller screen is not changed either way. The size is the window\'s from its start, so when the screen changes while Xsegon is open (a TV plugged in, or taken away) the window closes and opens again at the new screen\'s size. This switch itself takes effect the next time the window is opened.'],
        ],
        'screensaver' => [
            '_label' => 'Screensaver',
            '_help'  => 'What a console does when you walk away.',
            '_sections' => ['When it starts', 'What it shows'],
            'enabled'    => ['label' => 'Screensaver', 'section' => 'When it starts'],
            'afterMin'   => ['label' => 'Start after (minutes)', 'section' => 'When it starts', 'type' => 'number', 'min' => 1, 'max' => 120],
            'everySec'   => ['label' => 'Change art every (seconds)', 'section' => 'What it shows', 'type' => 'number', 'min' => 3, 'max' => 120],
            'mode'       => ['label' => 'Style', 'section' => 'What it shows', 'type' => 'enum',
                             'options' => ['art' => 'Drifting box art', 'clock' => 'Art and clock']],
        ],
        'debug' => [
            '_label' => 'Debug',
            '_help'  => 'Noise, for when something is wrong.',
            // Show the log and Report a problem are added by js/settings-ui.js.
            '_sections' => ['Logging', 'Getting help'],
            'logging'  =>['label' => 'Logging', 'section' => 'Logging',
                           'help' => 'Every action and request, page and server, to data\log\<day>.log. The L key shows the log.'],
            'logMoves' => ['label' => 'Log every selection', 'section' => 'Logging',
                           'help' => 'A SEL line each time you rest on a game. The noisiest line; off keeps the rest.'],
            'asked'    => ['type' => 'set'],
        ],
        'emulators' => [
            '_label' => 'Emulators',
            '_help'  => 'Where each emulator is, and which console it runs. Xsegon keeps its own list so that moving an emulator does not stop your games launching.',
            '_helpNoLb' => 'Where each emulator is, and which console it runs. Moving one takes effect on the next launch.',
        ],
    ];
}

/**
 * Sound sets are the folders that exist: Xsegon's own (data\sounds), then the
 * built-in ones (sounds\), each name once. A copied pack says so.
 */
function xs_sound_sets(array $s): array
{
    require_once __DIR__ . '/sounds.php';
    $own = xs_sound_packs_own();
    $out = [];
    foreach (xs_sound_pack_dirs($s) as $name => $dir) {
        $out[$name] = $name . (in_array($name, $own, true) ? '  (in Xsegon)' : '');
    }
    return $out ?: [XS_SOUND_BUILTIN => XS_SOUND_BUILTIN];
}

function xs_settings_path(): string
{
    return xs_data_path('settings.json');
}

/**
 * Where a setting used to live, and where it lives now. An older file is read
 * forward so a chosen volume or pack is not reset: the old keys stay as they
 * are, and a new key with no value of its own takes the old one.
 */
const XS_SETTINGS_MOVED = [
    ['feel',  'sounds',    'sound', 'sounds'],
    ['feel',  'volume',    'sound', 'volume'],
    ['feel',  'soundSet',  'sound', 'soundSet'],
    ['feel',  'backSound', 'sound', 'backSound'],
    ['feel',  'music',     'sound', 'music'],
    ['video', 'sound',     'sound', 'videoSound'],
    ['video', 'volume',    'sound', 'videoVolume'],
];
// Themes that moved into a family's folder: a copy that saved one under its old name still opens on it.
const XS_THEMES_MOVED = ['matrix' => 'neon/matrix', 'synthwave' => 'neon/synthwave', 'winter' => 'nature/winter'];

/* Volume levels are on a curve (loudness = level squared, js\sound.js). A
   file with no '_volumeScale' at its top holds straight levels: each is
   read as the level that sounds the same (50 is 71). */
const XS_VOLUME_SCALE = 2;

function xs_volume_onto_curve($old): int
{
    return (int) round(100 * sqrt(max(0, min(100, (float) $old)) / 100));
}

/** What kind of value this is, in the words a log line uses. */
function xs_settings_kind($v): string
{
    if (is_array($v)) {
        return $v === [] || array_is_list($v) ? 'list' : 'set';
    }
    return match (true) {
        $v === null              => 'null',
        is_bool($v)              => 'switch',
        is_int($v), is_float($v) => 'number',
        is_string($v)            => 'word',
        default                  => gettype($v),
    };
}

/**
 * Saved settings whose kind is not their default's kind: ["view.sort is a
 * number, its default a word", ...]. Such a value can crash the settings screen,
 * so GET api/settings.php logs each as WARN and the problem report lists them.
 * An empty list and an empty set are the same once saved, so either matches both.
 */
function xs_settings_drift(): array
{
    $defaults = xs_settings_defaults();
    $stored   = xs_read_json(xs_settings_path(), []);
    if (!is_array($stored)) {
        return ['the settings file is not a JSON object'];
    }
    $out = [];
    foreach ($stored as $group => $values) {
        if (!isset($defaults[$group]) || !is_array($values)) {
            continue;
        }
        foreach ($values as $key => $value) {
            if (!array_key_exists($key, $defaults[$group])) {
                continue;
            }
            // A text size saved as a word is read forward by xs_settings(), not a value of the wrong kind.
            if ($group === 'feel' && $key === 'textSize' && is_string($value)) {
                continue;
            }
            $def  = $defaults[$group][$key];
            $want = xs_settings_kind($def);
            $got  = xs_settings_kind($value);
            $same = $want === $got
                || (is_array($value) && is_array($def) && ($value === [] || $def === []))
                || ($want === 'word' && $got === 'null');
            if (!$same) {
                $out[] = $group . '.' . $key . ' is a ' . $got . ', its default a ' . $want;
            }
        }
    }
    return $out;
}

/** Merge stored over defaults, one level into each group. */
function xs_settings(): array
{
    $defaults = xs_settings_defaults();
    $stored   = xs_read_json(xs_settings_path(), []);
    if (!is_array($stored)) {
        return $defaults;
    }
    foreach ($stored as $group => $values) {
        if (isset($defaults[$group]) && is_array($values)) {
            $defaults[$group] = array_merge($defaults[$group], $values);
        }
    }
    // The badges are saved as one set: a switch the saved set has never heard of
    // takes its default, and one no longer known is dropped.
    if (is_array($stored['view']['badges'] ?? null)) {
        $known = xs_settings_defaults()['view']['badges'];
        $defaults['view']['badges'] = array_intersect_key(array_merge($known, $stored['view']['badges']), $known);
    }
    // So are the tips put away: one added later still shows to someone who put another away.
    if (is_array($stored['feel']['tipsGone'] ?? null)) {
        $known = xs_settings_defaults()['feel']['tipsGone'];
        $defaults['feel']['tipsGone'] = array_intersect_key(array_merge($known, $stored['feel']['tipsGone']), $known);
    }
    foreach (XS_SETTINGS_MOVED as [$fromGroup, $fromKey, $toGroup, $toKey]) {
        if (!isset($stored[$toGroup][$toKey]) && isset($stored[$fromGroup][$fromKey])) {
            $defaults[$toGroup][$toKey] = $stored[$fromGroup][$fromKey];
        }
        // A leftover old key is not handed to the page: one value, one place to read it.
        unset($defaults[$fromGroup][$fromKey]);
    }
    if (is_string($defaults['feel']['theme'] ?? null) && isset(XS_THEMES_MOVED[$defaults['feel']['theme']])) {
        $defaults['feel']['theme'] = XS_THEMES_MOVED[$defaults['feel']['theme']];
    }
    // Straight levels from before the curve, read as loud as they were.
    if ((int) ($stored['_volumeScale'] ?? 1) < XS_VOLUME_SCALE) {
        foreach (['volume' => ['feel', 'volume'], 'videoVolume' => ['video', 'volume']] as $key => [$oldGroup, $oldKey]) {
            if (isset($stored['sound'][$key]) || isset($stored[$oldGroup][$oldKey])) {
                $defaults['sound'][$key] = xs_volume_onto_curve($defaults['sound'][$key]);
            }
        }
    }
    /* An older text size is a word: Small and Large keep their size; Normal,
       the old default every Save wrote, takes the new default. */
    $size = $defaults['feel']['textSize'];
    if (!is_int($size)) {
        $defaults['feel']['textSize'] = is_numeric($size) ? max(12, min(28, (int) $size))
            : ((is_string($size) ? ['small' => 14, 'large' => 19][$size] ?? null : null)
               ?? xs_settings_defaults()['feel']['textSize']);
    }
    return $defaults;
}

/**
 * Merge an update into what is already stored. The stored file must be the
 * base: starting from an empty array makes each partial POST erase every
 * other setting.
 */
function xs_settings_save(array $incoming, ?string &$why = null): array
{
    $defaults = xs_settings_defaults();
    $schema = xs_settings_schema();
    $clean = xs_read_json(xs_settings_path(), []);
    if (!is_array($clean)) {
        $clean = [];
    }
    /* The first save onto the curve moves the file's straight levels too,
       so the mark at its top is never true of one level and not the other. */
    if ((int) ($clean['_volumeScale'] ?? 1) < XS_VOLUME_SCALE) {
        foreach (['volume' => ['feel', 'volume'], 'videoVolume' => ['video', 'volume']] as $key => [$oldGroup, $oldKey]) {
            $old = $clean['sound'][$key] ?? $clean[$oldGroup][$oldKey] ?? null;
            if (is_int($old) || is_float($old)) {
                $clean['sound'][$key] = xs_volume_onto_curve($old);
            }
        }
        $clean['_volumeScale'] = XS_VOLUME_SCALE;
    }
    foreach ($incoming as $group => $values) {
        if (!isset($defaults[$group]) || !is_array($values)) {
            continue;                       // unknown group: ignore, never store
        }
        foreach ($values as $key => $value) {
            if (!array_key_exists($key, $defaults[$group])) {
                continue;                   // unknown key: same
            }
            // Keep the default's type, so a checkbox posting "on" stays a bool.
            $want = $defaults[$group][$key];
            /* An array where a plain value belongs, or the other way round, is
               refused and logged: a value of the wrong kind breaks the settings
               screen, and casting an array to a string stores "Array". */
            if (is_array($want) !== is_array($value) && !(is_string($want) && $value === null)) {
                xs_log('WARN', 'settings: refused ' . $group . '.' . $key . ', wanted a '
                    . xs_settings_kind($want) . ', got a ' . xs_settings_kind($value) . ': '
                    . mb_substr((string) json_encode($value, JSON_UNESCAPED_SLASHES), 0, 80));
                continue;
            }
            $meta = $schema[$group][$key] ?? null;
            // A whole-number default whose control steps in halves keeps the half: an int cast drops it.
            $fractional = is_array($meta) && isset($meta['step']) && floor((float) $meta['step']) != (float) $meta['step'];
            if (is_bool($want))       { $value = (bool) $value; }
            elseif (is_int($want))    { $value = $fractional ? (float) $value : (int) $value; }
            elseif (is_float($want))  { $value = (float) $value; }
            elseif (is_string($want)) { $value = (string) $value; }
            // A number stays inside the range its control offers.
            if ((is_int($value) || is_float($value)) && is_array($meta)) {
                if (isset($meta['min']) && $value < $meta['min']) { $value = is_int($value) ? (int) $meta['min'] : (float) $meta['min']; }
                if (isset($meta['max']) && $value > $meta['max']) { $value = is_int($value) ? (int) $meta['max'] : (float) $meta['max']; }
            }
            // A theme must be one that is there: its choices are the files in themes\.
            if ($group === 'feel' && $key === 'theme') {
                require_once __DIR__ . '/themes.php';
                if (!array_key_exists((string) $value, xs_theme_list())) {
                    xs_log('WARN', 'settings: refused feel.theme = ' . mb_substr((string) $value, 0, 40) . ', not one of ' . implode(', ', array_keys(xs_theme_list())));
                    continue;
                }
            }
            /* A choice must be one of its choices, where the schema lists them;
               soundSet's come from the disk. */
            if (is_array($meta) && ($meta['type'] ?? '') === 'enum' && is_array($meta['options'] ?? null)
                && !array_key_exists((string) $value, $meta['options'])) {
                xs_log('WARN', 'settings: refused ' . $group . '.' . $key . ' = ' . mb_substr((string) $value, 0, 40)
                    . ', not one of ' . implode(', ', array_keys($meta['options'])));
                continue;
            }
            $clean[$group][$key] = $value;
        }
    }
    // A write that fails must reach the caller, or the page shows a value never saved.
    // $why is what the caller tells the person.
    xs_write_json(xs_settings_path(), $clean, $why);
    return xs_settings();
}
