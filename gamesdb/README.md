# The Games Database

Xsegon fills in games from a copy of the **LaunchBox Games Database**
(https://gamesdb.launchbox-app.com), made by LaunchBox
(https://www.launchbox-app.com) and the community that adds to it. All
credit for the games' details, descriptions and pictures goes to them.

It fills in names, descriptions, genres, release dates, developers,
publishers, ratings and players, and says which pictures exist. The pictures
themselves are fetched one at a time from LaunchBox's image server when a
game is filled in.

## Where it comes from

In the repository this folder holds only this README. The copy is one packed file,
`gamesdb.sqlite.bz2` (about 70 MB), with `gamesdb.json` beside it saying when
it was built and its checksum. Xsegon unpacks it the first time a game is
looked up, which takes about ten seconds, once. It is kept out of git, where each refresh
would add the whole file to the history again. Instead:

- The ready-to-run download has a copy here, so Xsegon works straight away,
  offline too.
- The newest copy is on the **gamesdb** release of
  [Xsegon-helper-files](https://github.com/TumultuousProductions/Xsegon-helper-files),
  replaced at each refresh, with `gamesdb.sig` beside it: `gamesdb.json`
  signed with Xsegon's update key. Xsegon takes no copy that key did not
  sign, and fetches a newer one in the background into
  `data\gamesdb-update\`. Settings > Library > "Games Database updates"
  chooses how: **Automatic** checks once a day at most, **Manual** only when
  you press **Check now** on the same page, which also says which copy is in
  use and what the last check found. Running from the source code with no
  copy here, the first check is how it gets one.

## What reads it

PHP, the same PHP that serves Xsegon (`bin\gamesdb.php`), so Xsegon needs no
second program for it.

Until October 2026 the reader was Node.js, and the download carried a copy
of Node.js for that one job. The two were then run side by side over the
whole database. They gave the same answers; PHP was as quick for one game
and about a quarter quicker for many; and without Node.js the download is
about a fifth smaller. Node.js was the lesser option and was removed. It is
still what Xsegon's tests run on, and nothing else.

## Refreshing it (for whoever publishes Xsegon)

LaunchBox publishes the whole database daily as
https://gamesdb.launchbox-app.com/Metadata.zip. To rebuild the copy from the
latest and publish it:

    php tools\build-gamesdb.php --publish

(`php` being the PHP Xsegon runs on.) It downloads about 110 MB, keeps only
what Xsegon reads, packs it into this folder, signs `gamesdb.json` with the
update key in `private\update-key.pem`, and replaces the files on the gamesdb
release of Xsegon-helper-files (GitHub CLI, logged in). It publishes nothing
it could not sign. `--publish-only` signs and publishes the copy already in
this folder without building. Nothing is committed. Every week or so is plenty.
