<?php
/**
 * Xsegon - fan projects: hacks, mods and PC versions made from games a person owns.
 *
 *     includes\fanprojects\projects.json   the list, shipped with Xsegon
 *
 * Each project names the releases it is made from. Whether the library holds one is
 * read from what Xsegon already keeps: the file check's release names for cartridges
 * (data\filecheck.json) and a disc's own ID for GameCube, Wii and a PlayStation PBP.
 * Xsegon never supplies a game and never hosts a team's files.
 */
declare(strict_types=1);

require_once __DIR__ . '/filecheck.php';
require_once __DIR__ . '/drives.php';

const XS_FAN_KINDS = ['patch' => 'Patch', 'pc' => 'PC version', 'disc' => 'Disc mod'];
const XS_FAN_FITS  = ['fits' => 2, 'works' => 1];
/** Where a disc's ID starts, by file ending: the disc's first byte inside each kind of file. */
const XS_FAN_DISC_AT = ['iso' => 0, 'gcm' => 0, 'ciso' => 0x8000, 'rvz' => 0x58, 'wia' => 0x58, 'wbfs' => 0x200];
/** The files a PlayStation game comes in whose disc IDs can be read; a .chd is compressed and is not. */
const XS_FAN_PS_ENDS = ['pbp', 'm3u', 'cue', 'bin', 'img', 'iso'];

/** The shipped list, each entry checked; a test copy may hand its own in data\fanprojects.json. */
function xs_fan_list(): array
{
    static $list = null;
    if ($list !== null) {
        return $list;
    }
    $own = xs_data_path('fanprojects.json');
    $doc = xs_read_json(xs_test_copy() && is_file($own) ? $own
        : XS_ROOT . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'fanprojects' . DIRECTORY_SEPARATOR . 'projects.json', null);
    $list = [];
    foreach (is_array($doc['projects'] ?? null) ? $doc['projects'] : [] as $p) {
        // Its website, its GitHub, or both; one that is there must be good, or the entry is left out.
        $page = isset($p['page']) ? (string) $p['page'] : null;
        $repo = isset($p['repo']) ? (string) $p['repo'] : null;
        if (!is_array($p) || !preg_match('/^[a-z0-9-]{1,40}$/', (string) ($p['id'] ?? ''))
            || !isset(XS_FAN_KINDS[$p['kind'] ?? '']) || !is_string($p['name'] ?? null) || !is_string($p['console'] ?? null)
            || ($page === null && $repo === null) || ($page !== null && !xs_fan_url_ok($page))
            || ($repo !== null && (!xs_fan_url_ok($repo) || !str_starts_with($repo, 'https://github.com/')))
            || !is_array($p['base']['match'] ?? null)) {
            continue;
        }
        if (isset($p['community']) && !xs_fan_url_ok((string) $p['community'])) {
            unset($p['community']);
        }
        if (isset($p['yours']['build']) && @preg_match('#' . $p['yours']['build'] . '#i', '') === false) {
            unset($p['yours']['build']);
        }
        // How it is made: only ever from the team's own website or GitHub, as the entry names them.
        if (isset($p['make']) && ($p['make']['how'] ?? 'patch') === 'patch') {
            $own = array_filter([parse_url((string) $page, PHP_URL_HOST), $repo !== null ? 'github.com' : null]);
            foreach (['list', 'from'] as $k) {
                $u = (string) ($p['make'][$k] ?? '');
                if (!xs_fan_url_ok($u) || !in_array(parse_url($u, PHP_URL_HOST), $own, true)) {
                    unset($p['make']);
                    break;
                }
            }
        } elseif (isset($p['make'])) {
            // A release from GitHub: the project's own, or one under the same owner its GitHub names.
            $from = (string) ($p['make']['repo'] ?? $repo);
            $owner = $repo !== null && preg_match('#^https://github\.com/[A-Za-z0-9_.-]+#', $repo, $o) ? $o[0] . '/' : null;
            if ($owner === null || !xs_fan_url_ok($from) || !str_starts_with($from . '/', $owner)
                || @preg_match('#' . (string) ($p['make']['asset'] ?? '') . '#i', '') === false) {
                unset($p['make']);
            }
        }
        $list[$p['id']] = $p;
    }
    return $list;
}

/**
 * Whether Make can make this project here: a recipe of a kind Xsegon follows (includes\fanmake.php),
 * a patch from the team's list, or a release from their GitHub given your game.
 */
function xs_fan_makes(array $p): bool
{
    $m = $p['make'] ?? null;
    if (!is_array($m) || !isset($p['repo'])) {
        return false;
    }
    $how = $m['how'] ?? 'patch';
    if ($how === 'pack') {
        // A Riivolution pack from the team's own server: every address theirs, every path inside its folder.
        require_once __DIR__ . '/fanmake.php';
        foreach (['install', 'updates', 'deletes'] as $k) {
            if (!xs_fm_own_url($p, (string) ($m[$k] ?? ''))) {
                return false;
            }
        }
        $paths = array_merge((array) ($m['take'] ?? []), [(string) ($m['version'] ?? ''), (string) ($m['xml'] ?? '')]);
        return ($m['take'] ?? []) && is_string($m['version'] ?? null) && is_string($m['xml'] ?? null)
            && preg_match('/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,60}$/', (string) ($m['folder'] ?? '')) === 1
            && !array_filter($paths, static fn($f) => !is_string($f) || $f === '' || str_contains($f, '..') || str_contains($f, ':'));
    }
    if ($how === 'build') {
        // The team's source and the tools their build guide names, each a GitHub release download of a size the list gives.
        $paths = [(string) ($m['compile'][0] ?? '')];
        foreach ((array) ($m['tools'] ?? []) as $t) {
            if (!preg_match('#^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+/releases/download/[A-Za-z0-9_.%+-]+/[A-Za-z0-9_.%+-]+\.zip$#', (string) ($t['url'] ?? ''))
                || (int) ($t['size'] ?? 0) <= 0) {
                return false;
            }
            $paths[] = (string) ($t['into'] ?? '');
        }
        foreach ((array) ($m['copy'] ?? []) as $c) {
            array_push($paths, (string) ($c[0] ?? '..'), (string) ($c[1] ?? '..'));
        }
        if (!is_string($m['branch'] ?? null) || !is_array($m['tools'] ?? null) || !is_array($m['compile'] ?? null) || count($m['compile']) < 2
            || $paths[0] === '' || array_filter($paths, static fn($f) => str_contains($f, '..') || str_contains($f, ':'))) {
            return false;
        }
        $m['asset'] = '';
    }
    if ($how === 'release' || $how === 'build') {
        $game = $m['game'] ?? null;
        return is_string($m['asset'] ?? null) && is_string($m['run'] ?? null) && !str_contains($m['run'], '..')
            && preg_match('/^[A-Za-z0-9][A-Za-z0-9 ._()+-]{0,60}$/', (string) ($m['folder'] ?? '')) === 1
            && is_array($game) && (isset($game['to']) || isset($game['discs']) || isset($game['ini'], $game['section'], $game['key']))
            && !array_filter(array_merge([$game['to'] ?? '', $game['discs'] ?? '', $game['ini'] ?? ''], (array) ($m['need'] ?? [])),
                             static fn($f) => str_contains((string) $f, '..') || str_contains((string) $f, ':'))
            && !array_filter((array) ($m['write'] ?? []), static fn($f) => !preg_match('/^[A-Za-z0-9][A-Za-z0-9._-]{0,60}$/', (string) $f));
    }
    return ($p['kind'] ?? '') === 'patch' && ($m['patch'] ?? '') === 'xdelta'
        && is_string($m['list'] ?? null) && is_string($m['from'] ?? null) && is_string($m['take'] ?? null);
}

/** An address that may be handed to Windows to open: https, and none of the characters a command line reads. */
function xs_fan_url_ok(string $url): bool
{
    return strlen($url) <= 200 && (bool) preg_match('@^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/:?=#-]*)?$@', $url);
}

/**
 * The disc IDs one library file holds: a GameCube or Wii image's six-letter ID with its version
 * byte, or the PlayStation IDs ("SCUS-94491") of every disc a .pbp holds or an .m3u lists, a
 * .cue's data track, a .bin or .iso's own. Null when none can be read.
 */
function xs_fan_disc_ids(string $file): ?array
{
    $end = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    if ($file === '' || (!isset(XS_FAN_DISC_AT[$end]) && !in_array($end, XS_FAN_PS_ENDS, true)) || xs_drive_stuck($file) !== null) {
        return null;
    }
    if (isset(XS_FAN_DISC_AT[$end]) && ($h = @fopen($file, 'rb')) !== false) {
        $b = fseek($h, XS_FAN_DISC_AT[$end]) === 0 ? (string) fread($h, 8) : '';
        fclose($h);
        if (strlen($b) === 8 && preg_match('/^[A-Z0-9]{6}$/', substr($b, 0, 6))) {
            return ['ids' => [substr($b, 0, 6)], 'version' => ord($b[7])];
        }
    }
    $ids = in_array($end, XS_FAN_PS_ENDS, true) ? xs_fan_ps_ids($file, $end) : [];
    return $ids ? ['ids' => $ids, 'version' => null] : null;
}

/** The PlayStation disc IDs in one file; the discs an .m3u lists are read one level down, never another list. */
function xs_fan_ps_ids(string $file, string $end, bool $top = true): array
{
    if ($end === 'pbp') {
        return xs_fan_pbp_ids($file);
    }
    if ($end !== 'm3u' && $end !== 'cue') {
        $id = xs_fan_ps_cnf_id($file);
        return $id === null ? [] : [$id];
    }
    $text = (string) @file_get_contents($file, false, null, 0, 65536);
    $files = [];
    if ($end === 'cue') {
        // The first FILE is the data track, where SYSTEM.CNF is.
        if (preg_match('/^\s*FILE\s+"([^"]+)"/mi', $text, $m) || preg_match('/^\s*FILE\s+(\S+)/mi', $text, $m)) {
            $files[] = $m[1];
        }
    } elseif ($top) {
        foreach (preg_split('/\r?\n/', $text) as $line) {
            if (($line = trim($line)) !== '' && $line[0] !== '#') {
                $files[] = $line;
            }
        }
    }
    $ids = [];
    foreach ($files as $f) {
        $path = preg_match('#^([A-Za-z]:)?[/\\\\]#', $f) ? $f : dirname($file) . DIRECTORY_SEPARATOR . $f;
        $e = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if ($e !== 'm3u' && in_array($e, XS_FAN_PS_ENDS, true) && is_file($path)) {
            $ids = array_merge($ids, xs_fan_ps_ids($path, $e, false));
        }
    }
    return array_values(array_unique($ids));
}

/** Every disc a PBP holds: one PSISOIMG, or a PSTITLEIMG's table of up to five, each naming its disc at 0x400 ("_SCUS_94491"). */
function xs_fan_pbp_ids(string $file): array
{
    $h = @fopen($file, 'rb');
    if ($h === false) {
        return [];
    }
    $head = (string) fread($h, 40);
    $ids = [];
    if (strlen($head) === 40 && substr($head, 0, 4) === "\0PBP") {
        $psar = unpack('V', $head, 0x24)[1];
        $top = fseek($h, $psar) === 0 ? (string) fread($h, 0x214) : '';
        $at = str_starts_with($top, 'PSTITLEIMG') && strlen($top) === 0x214 ? array_filter(array_values(unpack('V5', $top, 0x200)))
            : (str_starts_with($top, 'PSISOIMG') ? [0] : []);
        foreach ($at as $o) {
            $raw = fseek($h, $psar + $o + 0x400) === 0 ? (string) fread($h, 16) : '';
            if (preg_match('/^_?([A-Z]{4})_(\d{5})/', $raw, $m)) {
                $ids[] = $m[1] . '-' . $m[2];
            }
        }
    }
    fclose($h);
    return $ids;
}

/** A PlayStation disc image's ID, from the BOOT line of its SYSTEM.CNF: raw 2352-byte sectors (.bin, .img) or 2048 (.iso). */
function xs_fan_ps_cnf_id(string $file): ?string
{
    $h = @fopen($file, 'rb');
    if ($h === false) {
        return null;
    }
    $read = null;
    foreach ([[2352, 24], [2352, 16], [2048, 0]] as [$size, $skip]) {
        $sector = static fn(int $lba, int $bytes = 2048): string => fseek($h, $lba * $size + $skip) === 0 ? (string) fread($h, $bytes) : '';
        if (substr($sector(16), 1, 5) === 'CD001') {
            $read = $sector;
            break;
        }
    }
    $id = null;
    if ($read !== null) {
        // The root directory's record is at 156 of the volume descriptor: where it starts, then how long it is.
        $root = unpack('Vat/x4/Vlen', $read(16), 158);
        $dir = '';
        for ($i = 0, $n = min(8, intdiv($root['len'] + 2047, 2048)); $i < $n; $i++) {
            $dir .= str_pad($read($root['at'] + $i), 2048, "\0");
        }
        for ($p = 0; $p + 33 < strlen($dir);) {
            $len = ord($dir[$p]);
            if ($len === 0) {                // no record crosses a sector: the rest of this one is empty
                $p = (intdiv($p, 2048) + 1) * 2048;
                continue;
            }
            if (str_starts_with(strtoupper(substr($dir, $p + 33, ord($dir[$p + 32]))), 'SYSTEM.CNF')) {
                $f = unpack('Vat/x4/Vlen', $dir, $p + 2);
                if (preg_match('/BOOT\s*=\s*cdrom0?:\\\\*([A-Z]{4})[_-]?(\d{3})\.?(\d{2})/i', $read($f['at'], min(2048, $f['len'])), $m)) {
                    $id = strtoupper($m[1]) . '-' . $m[2] . $m[3];
                }
                break;
            }
            $p += $len;
        }
    }
    fclose($h);
    return $id;
}

/** A PC version's build, named in a file beside what it runs ("lod-game-d3d4c02...jar" is build d3d4c02); null when none says. */
function xs_fan_build(string $run, string $re): ?string
{
    $dir = dirname($run);
    if ($run === '' || xs_drive_stuck($dir) !== null || !is_dir($dir)) {
        return null;
    }
    foreach ((array) @scandir($dir) as $f) {
        if (preg_match('#' . $re . '#i', (string) $f, $m) && isset($m[1])) {
            return 'build ' . $m[1];
        }
    }
    return null;
}

/** An N64 cartridge's two header checksums as "XXXXXXXX-XXXXXXXX", whatever its byte order; null when it is no plain cartridge file. */
function xs_fan_n64_id(string $file): ?string
{
    if (!in_array(strtolower(pathinfo($file, PATHINFO_EXTENSION)), ['z64', 'n64', 'v64'], true) || xs_drive_stuck($file) !== null) {
        return null;
    }
    $b = (string) @file_get_contents($file, false, null, 0, 24);
    if (strlen($b) < 24) {
        return null;
    }
    $magic = bin2hex(substr($b, 0, 4));
    if ($magic === '37804012') {            // .v64: every two bytes swapped
        $b = implode('', array_map('strrev', str_split($b, 2)));
    } elseif ($magic === '40123780') {      // .n64: every four bytes reversed
        $b = implode('', array_map('strrev', str_split($b, 4)));
    } elseif ($magic !== '80371240') {
        return null;
    }
    return strtoupper(bin2hex(substr($b, 16, 4)) . '-' . bin2hex(substr($b, 20, 4)));
}

/** A title reduced to its words, so "Legend of Zelda, The - Ocarina of Time" meets "The Legend of Zelda: Ocarina of Time". */
function xs_fan_words(string $title): string
{
    $t = preg_replace('/[^a-z0-9]+/', ' ', strtolower($title));
    return trim((string) preg_replace('/\s+/', ' ', (string) preg_replace('/\bthe\b/', ' ', (string) $t)));
}

/**
 * Every project with where it stands for this library: the base it is made from (fits,
 * works, another version, some of its discs, not checked, not readable, or missing) and
 * the copies that are already yours.
 */
function xs_fan_states(array $games): array
{
    $s = xs_settings();
    $fc = xs_fc_all();
    $wanted = xs_read_json(xs_data_path('wanted.json'), []);
    $made = xs_read_json(xs_data_path('fan-made.json'), []);
    $made = is_array($made) ? $made : [];
    $on = [];
    $byId = [];
    foreach ($games as $g) {
        $on[(string) ($g['platform'] ?? '')][] = $g;
        $byId[(string) $g['id']] = $g;
    }
    $discs = [];                         // a game's discs read once a request, however many projects ask
    $disc = static function (array $g) use (&$discs, $s): ?array {
        $id = (string) $g['id'];
        if (!array_key_exists($id, $discs)) {
            $discs[$id] = xs_fan_disc_ids(xs_rom_real_path((string) ($g['romPath'] ?? ''), $s));
        }
        return $discs[$id];
    };
    $out = [];
    foreach (xs_fan_list() as $p) {
        $best = null;
        $part = null;                    // a set of discs found only in part: which, and the game holding the first
        $want = xs_fan_words((string) ($p['base']['db']['title'] ?? $p['base']['title']));
        foreach ($p['base']['match'] as $m) {
            $rank = XS_FAN_FITS[$m['fit'] ?? ''] ?? 0;
            $at = $on[(string) ($m['console'] ?? '')] ?? [];
            if (isset($m['discs'])) {
                // Every disc of a set, from one file holding them all (a .pbp, an .m3u) or from several;
                // only games carrying the base's name are read, never a whole console.
                $need = array_values((array) $m['discs']);
                $have = [];
                $lead = null;
                foreach ($at as $g) {
                    if (!str_contains(' ' . xs_fan_words((string) $g['title']) . ' ', ' ' . $want . ' ')) {
                        continue;
                    }
                    $got = array_values(array_intersect($need, $disc($g)['ids'] ?? []));
                    if ($got && ($lead === null || in_array($need[0], $got, true))) {
                        $lead = $g;
                    }
                    $have = array_values(array_unique(array_merge($have, $got)));
                }
                if ($lead !== null && count($have) === count($need) && $rank > ($best['rank'] ?? 0)) {
                    $best = ['rank' => $rank, 'state' => $m['fit'], 'game' => $lead, 'note' => (string) ($m['note'] ?? ''),
                             'release' => implode(', ', $need)];
                } elseif ($lead !== null && count($have) < count($need) && count($have) > count($part['have'] ?? [])) {
                    $part = ['game' => $lead, 'have' => $have, 'need' => $need];
                }
                continue;
            }
            foreach ($at as $g) {
                $rec = $fc[$g['id']] ?? null;
                $hit = isset($m['name']) ? (($rec['kind'] ?? '') === 'known' && ($rec['name'] ?? '') === $m['name'])
                     : (isset($m['disc']) && ($d = $disc($g)) !== null && in_array($m['disc'], $d['ids'], true)
                        && (!isset($m['version']) || $d['version'] === (int) $m['version']));
                if ($hit && $rank > ($best['rank'] ?? 0)) {
                    $best = ['rank' => $rank, 'state' => $m['fit'], 'game' => $g, 'note' => (string) ($m['note'] ?? ''),
                             'release' => isset($m['name']) ? $m['name'] : $m['disc']];
                }
            }
        }
        $base = ['title' => (string) $p['base']['title'], 'db' => $p['base']['db'] ?? null];
        if ($best !== null) {
            $base += ['state' => $best['state'], 'gameId' => $best['game']['id'], 'yourTitle' => $best['game']['title'],
                      'release' => $best['release'], 'note' => $best['note']];
        } elseif ($part !== null) {
            // Some of a set's discs and not all: said so, never taken for the game.
            $base += ['state' => 'partial', 'gameId' => $part['game']['id'], 'yourTitle' => $part['game']['title'],
                      'have' => count($part['have']), 'need' => count($part['need']), 'release' => implode(', ', $part['have'])];
        } else {
            // The same game in another release, a cartridge the file check has not read yet, or a disc whose ID its file does not give up (a .chd).
            $consoles = array_unique(array_map(static fn($m) => (string) ($m['console'] ?? ''), $p['base']['match']));
            foreach ($consoles as $c) {
                foreach ($on[$c] ?? [] as $g) {
                    if (xs_fan_words((string) $g['title']) !== $want) {
                        continue;
                    }
                    $rec = $fc[$g['id']] ?? null;
                    $d = $rec === null ? $disc($g) : null;
                    $base += ['state' => $rec !== null || $d !== null ? 'other' : (xs_fc_can($c) ? 'unchecked' : 'unread'),
                              'gameId' => $g['id'], 'yourTitle' => $g['title'],
                              'release' => (string) ($rec['name'] ?? implode(', ', $d['ids'] ?? []))];
                    break 2;
                }
            }
            $base += ['state' => 'missing'];
        }
        $base['wanted'] = isset($p['base']['db']['id']) && isset($wanted[(string) $p['base']['db']['id']]);

        // Copies already yours: a patched cartridge by the header the team's files carry, or
        // a PC version kept as a game of your own by its name, its build from a file beside what it runs.
        $yours = [];
        $y = $p['yours'] ?? null;
        if (is_array($y) && isset($y['header'])) {
            foreach ($on[$p['console']] ?? [] as $g) {
                $rec = $fc[$g['id']] ?? null;
                if (trim((string) ($rec['header']['title'] ?? '')) !== $y['header']) {
                    continue;
                }
                $ver = $y['crc'][(string) ($rec['crc'] ?? '')] ?? null;
                if ($ver === null && isset($y['ids'])) {
                    $ver = $y['ids'][(string) xs_fan_n64_id(xs_rom_real_path((string) ($g['romPath'] ?? ''), $s))] ?? null;
                }
                $yours[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'], 'local' => !empty($g['local']), 'version' => $ver];
            }
        } elseif (is_array($y) && isset($y['title'], $y['console'])) {
            $name = ' ' . xs_fan_words((string) $y['title']) . ' ';
            foreach ($on[(string) $y['console']] ?? [] as $g) {
                if (str_contains(' ' . xs_fan_words((string) $g['title']) . ' ', $name)) {
                    $yours[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'], 'local' => !empty($g['local']),
                                'version' => isset($y['build']) ? xs_fan_build((string) ($g['romPath'] ?? ''), (string) $y['build']) : null];
                }
            }
        }
        // And what Make made, known by the record it kept, before a file check has read it.
        $mine = array_column($yours, 'id');
        foreach ($made as $mid => $rec) {
            if (($rec['project'] ?? '') === $p['id'] && isset($byId[$mid]) && !in_array($mid, $mine, true)) {
                $g = $byId[$mid];
                $yours[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'], 'local' => !empty($g['local']),
                            'version' => (string) ($rec['version'] ?? '') ?: null];
            }
        }
        // The newest first: what Play starts.
        usort($yours, static fn($a, $b) => version_compare((string) $b['version'], (string) $a['version']));

        $out[] = [
            'id' => $p['id'], 'name' => $p['name'], 'kind' => $p['kind'], 'kindLabel' => XS_FAN_KINDS[$p['kind']],
            'console' => $p['console'], 'adds' => (string) ($p['adds'] ?? ''), 'tags' => array_values((array) ($p['tags'] ?? [])),
            'team' => (string) ($p['team'] ?? ''), 'licence' => (string) ($p['licence'] ?? ''),
            'page' => $p['page'] ?? null, 'repo' => $p['repo'] ?? null, 'community' => $p['community'] ?? null, 'base' => $base, 'yours' => $yours,
            'make' => xs_fan_makes($p),
            // The picture: a copy of yours, else the game it is made from.
            'pic' => $yours[0]['id'] ?? ($base['gameId'] ?? null),
        ];
    }
    return $out;
}

/** The address a project's button opens, from the list alone: nothing a request says is ever opened. */
function xs_fan_url(string $id, string $which): ?string
{
    $p = xs_fan_list()[$id] ?? null;
    $url = $p === null || !in_array($which, ['page', 'repo', 'community'], true) ? null : ($p[$which] ?? null);
    return is_string($url) && xs_fan_url_ok($url) ? $url : null;
}
