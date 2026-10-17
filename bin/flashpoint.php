<?php
/**
 * Xsegon - read Flashpoint's game list (Data\flashpoint.sqlite), only ever read.
 *
 *   php bin\flashpoint.php count <flashpoint folder>             how many games and animations it lists
 *   php bin\flashpoint.php facts <flashpoint folder> <ask file>  each asked game's facts; the ask file is
 *                                                                { "ids": [Flashpoint's game IDs], "hide": [tag names] }
 *                                                                (or the bare list of IDs); each game says
 *                                                                which hide tag it carries, by any of its names
 *
 * One JSON answer on stdout for one ask; includes\flashpoint.php runs it with the sqlite3
 * extension named on its command line, as the Games Database reader is run. The columns are
 * read from the file, so one Flashpoint version's names and another's both serve.
 */
declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

ini_set('display_errors', '0');
error_reporting(E_ALL);
set_time_limit(0);

function out(array $o): void
{
    echo json_encode($o, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    exit(0);
}
function fail(string $m): void
{
    out(['ok' => false, 'error' => $m]);
}
set_exception_handler(static function (Throwable $e): void {
    fail('Flashpoint\'s game list could not be read: ' . $e->getMessage());
});
set_error_handler(static function (int $no, string $msg, string $file, int $line): bool {
    if ($no === E_DEPRECATED || $no === E_USER_DEPRECATED || !(error_reporting() & $no)) {
        return true;
    }
    throw new ErrorException($msg, 0, $no, $file, $line);
});

if (!extension_loaded('sqlite3')) {
    fail('this PHP was started without its sqlite3 extension, which reading Flashpoint\'s game list needs');
}

$cmd = (string) ($argv[1] ?? '');
$fp  = rtrim((string) ($argv[2] ?? ''), '\\/');
$file = $fp . DIRECTORY_SEPARATOR . 'Data' . DIRECTORY_SEPARATOR . 'flashpoint.sqlite';
if ($fp === '' || !is_file($file)) {
    fail('Flashpoint\'s game list is not there: ' . $file);
}
$db = new SQLite3($file, SQLITE3_OPEN_READONLY);
$db->busyTimeout(5000);           // the launcher may be writing to it: wait a moment rather than fail

/** A table's columns, by name. */
function cols(SQLite3 $db, string $table): array
{
    $have = [];
    $r = $db->query('PRAGMA table_info(' . $table . ')');
    while ($r && ($row = $r->fetchArray(SQLITE3_ASSOC))) {
        $have[(string) $row['name']] = true;
    }
    return $have;
}

/** The first of these columns the table has, as an SQL expression, or '' where it has none. */
function pick(array $have, array $names): string
{
    foreach ($names as $n) {
        if (isset($have[$n])) {
            return '"' . $n . '"';
        }
    }
    return "''";
}

if ($cmd === 'count') {
    $n = (int) $db->querySingle('SELECT COUNT(*) FROM game');
    out(['ok' => true, 'total' => $n]);
}

if ($cmd === 'facts') {
    $ask = json_decode((string) @file_get_contents((string) ($argv[3] ?? '')), true);
    $ask = is_array($ask) ? $ask : [];
    $hide = array_values(array_filter((array) ($ask['hide'] ?? []), static fn($t) => is_string($t) && trim($t) !== ''));
    $ask = isset($ask['ids']) ? (array) $ask['ids'] : $ask;
    $ids = array_values(array_filter($ask, static fn($i) => is_string($i) && preg_match('/^[0-9a-f-]{36}$/i', $i)));
    $g = cols($db, 'game');
    $d = cols($db, 'game_data');
    // The hide tags by Flashpoint's tag numbers, any of a tag's names matching, as Flashpoint matches them.
    $hideIds = [];
    $qt = null;
    if ($hide && cols($db, 'tag_alias') && cols($db, 'game_tags_tag') && cols($db, 'tag')) {
        $qa = $db->prepare('SELECT a.tagId AS id, (SELECT p.name FROM tag t JOIN tag_alias p ON p.id = t.primaryAliasId WHERE t.id = a.tagId) AS name'
                           . ' FROM tag_alias a WHERE a.name = :n COLLATE NOCASE');
        foreach ($hide as $n) {
            $qa->bindValue(':n', trim($n), SQLITE3_TEXT);
            $r = $qa->execute();
            while ($r && ($row = $r->fetchArray(SQLITE3_ASSOC))) {
                $hideIds[(int) $row['id']] = (string) ($row['name'] ?? '') !== '' ? (string) $row['name'] : trim($n);
            }
        }
        $qt = $hideIds ? $db->prepare('SELECT tagId FROM game_tags_tag WHERE gameId = :id') : null;
    }
    $hideNames = array_change_key_case(array_flip(array_map('trim', $hide)), CASE_LOWER);
    $sel = 'SELECT id, ' . pick($g, ['title']) . ' AS title, ' . pick($g, ['developer']) . ' AS developer, '
         . pick($g, ['publisher']) . ' AS publisher, ' . pick($g, ['releaseDate']) . ' AS released, '
         . pick($g, ['originalDescription']) . ' AS description, ' . pick($g, ['platformName', 'platform']) . ' AS platform, '
         . pick($g, ['library']) . ' AS library, ' . pick($g, ['playMode']) . ' AS playMode, '
         . pick($g, ['status']) . ' AS status, ' . pick($g, ['tagsStr']) . ' AS tags, '
         . pick($g, ['applicationPath', 'legacyApplicationPath']) . ' AS app, '
         . pick($g, ['launchCommand', 'legacyLaunchCommand']) . ' AS command, ' . pick($g, ['broken']) . ' AS broken FROM game WHERE id = :id';
    $q = $db->prepare($sel);
    $qd = $d ? $db->prepare('SELECT ' . pick($d, ['presentOnDisk']) . ' AS present, ' . pick($d, ['path']) . ' AS path, '
                            . pick($d, ['size']) . ' AS size, ' . pick($d, ['sha256']) . ' AS sha256, '
                            . pick($d, ['applicationPath']) . ' AS app, ' . pick($d, ['launchCommand']) . ' AS command, '
                            . pick($d, ['parameters']) . ' AS parameters FROM game_data WHERE gameId = :id ORDER BY '
                            . (isset($d['dateAdded']) ? '"dateAdded" DESC' : 'rowid DESC') . ' LIMIT 1') : null;
    $games = [];
    foreach ($ids as $id) {
        $q->bindValue(':id', $id, SQLITE3_TEXT);
        $r = $q->execute();
        $row = $r ? $r->fetchArray(SQLITE3_ASSOC) : false;
        if (!$row) {
            continue;
        }
        $row = array_map(static fn($v) => $v === null ? '' : $v, $row);
        $row['broken'] = !empty($row['broken']);
        $row['hiddenBy'] = '';
        if ($qt !== null) {
            $qt->bindValue(':id', $id, SQLITE3_TEXT);
            $rt = $qt->execute();
            while ($rt && ($t = $rt->fetchArray(SQLITE3_NUM))) {
                if (isset($hideIds[(int) $t[0]])) {
                    $row['hiddenBy'] = $hideIds[(int) $t[0]];
                    break;
                }
            }
        } elseif ($hideNames) {
            // A list without Flashpoint's tag tables: the names its games carry.
            foreach (explode(';', (string) $row['tags']) as $t) {
                if (isset($hideNames[strtolower(trim($t))])) {
                    $row['hiddenBy'] = trim($t);
                    break;
                }
            }
        }
        $data = null;
        if ($qd !== null) {
            $qd->bindValue(':id', $id, SQLITE3_TEXT);
            $rd = $qd->execute();
            $dr = $rd ? $rd->fetchArray(SQLITE3_ASSOC) : false;
            if ($dr) {
                $data = ['present' => (bool) $dr['present'], 'path' => (string) $dr['path'], 'size' => (int) $dr['size'],
                         'sha256' => (string) $dr['sha256'], 'extract' => str_starts_with(trim((string) $dr['parameters']), '-extract')];
                // Where a game has data, the player and its argument are kept with it.
                if ((string) $dr['app'] !== '') {
                    $row['app'] = (string) $dr['app'];
                    $row['command'] = (string) $dr['command'];
                }
            }
        }
        $row['data'] = $data;
        $games[(string) $row['id']] = $row;
    }
    out(['ok' => true, 'games' => $games]);
}

fail('no such ask: ' . $cmd);
