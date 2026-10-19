# Change Xsegon yourself

Xsegon is plain files you can open in Notepad. There is nothing to build and
nothing to install: change a file, save it, and press **F5** in Xsegon to see
the change. A change to a `.php` file needs no F5 for the server's part: the
next press uses it.

Keep a copy of a file before you change it, so you can put it back.

## Just the look

**Settings > Feel > Your own look > Open my folder** opens `custom\style.css`.
Xsegon reads it after its own stylesheet, so whatever you write there wins,
and no update ever touches that folder. The file says what to do in it; the
colours and sizes it can change are named at the top of `css\xsegon.css`,
under `:root`.

A theme is a small file too: `themes\dark.json`, or one in a family folder
such as `themes\space\stars.json`. Copy one, give it a new name, change its
colours (`#rrggbb`), and it shows under **Themes** in the logo's menu. A theme
file you add is kept through updates.

## Which file draws what

`js\` is the page, one file for each part, and each file's first lines say what
it draws. `api\` answers the page's questions, `includes\` does the server's
work, and `bin\` holds the helpers that run outside the page.

| What you see | Where it is |
|---|---|
| The whole page: what loads, and in what order | `index.php` |
| Every colour, size and animation | `css\xsegon.css` |
| The consoles screen, the wheel and the carousel | `js\systems.js`, `js\views.js` |
| The list and its columns | `js\list.js`, `js\library.js` |
| The rows view and the shelf | `js\rows.js`, `js\shelf.js` |
| The panel beside the games | `js\hero.js` |
| A game's details and its tabs | `js\details.js`, `js\detailtabs.js`, and a file for each tab, such as `js\cheattab.js` or `js\mediatab.js` |
| The menus | `js\menus.js` |
| Settings | `js\settings-ui.js`; every switch and its words are listed in `includes\settings.php` |
| Messages | `js\news.js` |
| The legend along the bottom | `js\help.js` |
| What each key and controller button does | `js\input.js` |
| The sounds | `js\sound.js`, and the files in `sounds\` |
| The page a phone opens | `phone\` |
| Starting a game | `api\launch.php`, `bin\launch.ps1` |
| Finding games (Scan for Games) | `includes\scan.php` |
| Starting Xsegon | `start.ps1` |

## Keeping your changes through updates

**Update now** puts every one of Xsegon's own files in place. A file of
Xsegon's that you changed is not lost: it is kept in `data\update\previous`,
and **Settings > Window > New versions** names it. To carry a change across
every update:

- a change to the look goes in your own folder, `custom\`;
- a theme goes in a file of your own in `themes\`;
- anything else can be offered back, below, so it comes with the next version.

## Offering a change back

Xsegon's code is on GitHub:
[github.com/TumultuousProductions/Xsegon](https://github.com/TumultuousProductions/Xsegon).
Make your own copy there (**Fork**), put your change on a branch, and open a
pull request that says what it changes for the person at the screen.
`node tests\lanes.js quick` runs the quick tests (Node.js 22.5 or newer); the
README's **Running from the source code** says what else the code needs.

Xsegon is MIT licensed (`LICENSE`): change it, keep your changes and share
them, as long as the licence and its copyright line go with it.

Questions: help@tumultuousproductions.site.
