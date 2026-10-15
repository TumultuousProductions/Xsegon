<?php
/**
 * Xsegon - fan projects: hacks, mods and PC versions made from games a person owns.
 *
 *     includes\fanprojects\projects.json   the list, shipped with Xsegon
 *
 * Each project names the releases it is made from. Whether the library holds one is
 * read from what Xsegon already keeps: the file check's release names for cartridges
 * (data\filecheck.json) and a disc's own ID for GameCube and Wii. Xsegon never supplies
 * a game and never hosts a team's files.
 */
declare(strict_types=1);

require_once __DIR__ . '/filecheck.php';
require_once __DIR__ . '/drives.php';

const XS_FAN_KINDS = ['patch' => 'Patch', 'pc' => 'PC version', 'disc' => 'Disc mod'];
const XS_FAN_FITS  = ['fits' => 2, 'works' => 1];
/** Where a disc's ID starts, by file ending: the disc's first byte inside each kind of file. */
const XS_FAN_DISC_AT = ['iso' => 0, 'gcm' => 0, 'ciso' => 0x8000, 'rvz' => 0x58, 'wia' => 0x58, 'wbfs' => 0x200];

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
        if (!is_array($p) || !preg_match('/^[a-z0-9-]{1,40}$/', (string) ($p['id'] ?? ''))
            || !isset(XS_FAN_KINDS[$p['kind'] ?? '']) || !is_string($p['name'] ?? null) || !is_string($p['console'] ?? null)
            || !xs_fan_url_ok((string) ($p['page'] ?? '')) || !is_array($p['base']['match'] ?? null)) {
            continue;
        }
        if (isset($p['community']) && !xs_fan_url_ok((string) $p['community'])) {
            unset($p['community']);
        }
        $list[$p['id']] = $p;
    }
    return $list;
}

/** An address that may be handed to Windows to open: https, and none of the characters a command line reads. */
function xs_fan_url_ok(string $url): bool
{
    return strlen($url) <= 200 && (bool) preg_match('@^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~/:?=#-]*)?$@', $url);
}

/** A disc's six-letter ID and its version byte, read from the file; null for a file that holds none. */
function xs_fan_disc_id(string $file): ?array
{
    $at = XS_FAN_DISC_AT[strtolower(pathinfo($file, PATHINFO_EXTENSION))] ?? null;
    if ($at === null || xs_drive_stuck($file) !== null) {
        return null;
    }
    $h = @fopen($file, 'rb');
    if ($h === false) {
        return null;
    }
    $b = fseek($h, $at) === 0 ? (string) fread($h, 8) : '';
    fclose($h);
    if (strlen($b) < 8 || !preg_match('/^[A-Z0-9]{6}$/', substr($b, 0, 6))) {
        return null;
    }
    return ['id' => substr($b, 0, 6), 'version' => ord($b[7])];
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
 * works, another version, not checked, or missing) and the copies that are already yours.
 */
function xs_fan_states(array $games): array
{
    $s = xs_settings();
    $fc = xs_fc_all();
    $wanted = xs_read_json(xs_data_path('wanted.json'), []);
    $on = [];
    foreach ($games as $g) {
        $on[(string) ($g['platform'] ?? '')][] = $g;
    }
    $discs = [];                         // a disc read once a request, however many projects ask
    $disc = static function (array $g) use (&$discs, $s): ?array {
        $id = (string) $g['id'];
        if (!array_key_exists($id, $discs)) {
            $discs[$id] = xs_fan_disc_id(xs_rom_real_path((string) ($g['romPath'] ?? ''), $s));
        }
        return $discs[$id];
    };
    $out = [];
    foreach (xs_fan_list() as $p) {
        $best = null;
        foreach ($p['base']['match'] as $m) {
            $rank = XS_FAN_FITS[$m['fit'] ?? ''] ?? 0;
            foreach ($on[(string) ($m['console'] ?? '')] ?? [] as $g) {
                $rec = $fc[$g['id']] ?? null;
                $hit = isset($m['name']) ? (($rec['kind'] ?? '') === 'known' && ($rec['name'] ?? '') === $m['name'])
                     : (isset($m['disc']) && ($d = $disc($g)) !== null && $d['id'] === $m['disc']
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
        } else {
            // The same game in another release, or one the file check has not read yet.
            $want = xs_fan_words((string) ($p['base']['db']['title'] ?? $p['base']['title']));
            $consoles = array_unique(array_map(static fn($m) => (string) ($m['console'] ?? ''), $p['base']['match']));
            foreach ($consoles as $c) {
                foreach ($on[$c] ?? [] as $g) {
                    if (xs_fan_words((string) $g['title']) !== $want) {
                        continue;
                    }
                    $rec = $fc[$g['id']] ?? null;
                    $cart = !in_array(strtolower(pathinfo((string) ($g['romPath'] ?? ''), PATHINFO_EXTENSION)), array_keys(XS_FAN_DISC_AT), true);
                    $base += ['state' => $cart && $rec === null ? 'unchecked' : 'other', 'gameId' => $g['id'], 'yourTitle' => $g['title'],
                              'release' => (string) ($rec['name'] ?? (($d = $disc($g)) !== null ? $d['id'] : ''))];
                    break 2;
                }
            }
            $base += ['state' => 'missing'];
        }
        $base['wanted'] = isset($p['base']['db']['id']) && isset($wanted[(string) $p['base']['db']['id']]);

        // Copies already yours, by the cartridge header the team's files carry.
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
                $yours[] = ['id' => $g['id'], 'title' => $g['title'], 'platform' => $g['platform'], 'version' => $ver];
            }
            // The newest first: what Play starts.
            usort($yours, static fn($a, $b) => version_compare((string) $b['version'], (string) $a['version']));
        }

        $out[] = [
            'id' => $p['id'], 'name' => $p['name'], 'kind' => $p['kind'], 'kindLabel' => XS_FAN_KINDS[$p['kind']],
            'console' => $p['console'], 'adds' => (string) ($p['adds'] ?? ''), 'tags' => array_values((array) ($p['tags'] ?? [])),
            'team' => (string) ($p['team'] ?? ''), 'licence' => (string) ($p['licence'] ?? ''),
            'page' => $p['page'], 'community' => $p['community'] ?? null, 'base' => $base, 'yours' => $yours,
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
    $url = $p === null ? null : ($which === 'community' ? ($p['community'] ?? null) : ($which === 'page' ? $p['page'] : null));
    return is_string($url) && xs_fan_url_ok($url) ? $url : null;
}
