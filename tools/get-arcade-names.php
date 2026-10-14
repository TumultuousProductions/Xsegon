<?php
/**
 * Xsegon - make the list of arcade set names (includes\arcade\names.tsv.gz).
 *
 *     php tools\get-arcade-names.php --mame C:\path\to\mame.exe
 *     php tools\get-arcade-names.php --xml  mame0281.xml
 *
 * An arcade game's file is named by MAME's short name ("kof2003.zip"). MAME's
 * -listxml names every machine; this keeps four facts a machine:
 *
 *     short name <tab> title <tab> kind <tab> parent
 *
 * kind:  g  a game
 *        b  a BIOS set (neogeo.zip): other games need it, it is not one
 *        d  a device, or a machine that cannot be run by itself
 *        m  a mechanical machine (a fruit machine, a pinball table)
 *        s  a computer or console that takes software, not a game
 *
 * --mame runs that MAME with -listxml (it prints, it starts nothing); --xml
 * reads a list already made, such as the one MAME publishes with each
 * version. The list is kept in the repository.
 */
declare(strict_types=1);

$opt = getopt('', ['mame:', 'xml:']);
$out = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'includes' . DIRECTORY_SEPARATOR . 'arcade';
if (empty($opt['mame']) && empty($opt['xml'])) {
    fwrite(STDERR, "say where the list comes from: --mame <mame.exe> or --xml <file>\n");
    exit(2);
}
if (!empty($opt['xml'])) {
    $xml = (string) $opt['xml'];
    if (!is_file($xml)) {
        fwrite(STDERR, "not there: $xml\n");
        exit(2);
    }
} else {
    $exe = (string) $opt['mame'];
    if (!is_file($exe)) {
        fwrite(STDERR, "not there: $exe\n");
        exit(2);
    }
    $xml = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'xs-mame-list-' . getmypid() . '.xml';
    echo "asking MAME for its list (about a minute)...\n";
    $run = proc_open('"' . $exe . '" -listxml', [1 => ['file', $xml, 'w'], 2 => ['file', 'NUL', 'w']], $pipes, dirname($exe), null, ['bypass_shell' => true]);
    if (!is_resource($run) || proc_close($run) !== 0 || filesize($xml) < 1000000) {
        fwrite(STDERR, "MAME did not print its list\n");
        @unlink($xml);
        exit(1);
    }
}

$r = new XMLReader();
if (!$r->open($xml, null, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE)) {
    fwrite(STDERR, "could not read $xml\n");
    exit(1);
}
$build = '';
$rows  = [];
$count = ['g' => 0, 'b' => 0, 'd' => 0, 'm' => 0, 's' => 0];
// What a machine takes its software on: one of these and no coin slot is a computer or a console.
$media = ['cartridge', 'floppydisk', 'cassette', 'cdrom', 'harddisk', 'memcard', 'printout', 'quickload', 'snapshot', 'romimage', 'magtape', 'punchtape', 'punchcard', 'cylinder'];
while ($r->read()) {
    if ($r->nodeType !== XMLReader::ELEMENT) {
        continue;
    }
    if ($r->name === 'mame' || $r->name === 'mess') {
        $build = (string) $r->getAttribute('build');
        continue;
    }
    if ($r->name !== 'machine' && $r->name !== 'game') {
        continue;
    }
    $short = strtolower((string) $r->getAttribute('name'));
    $kind  = 'g';
    if ($r->getAttribute('isbios') === 'yes') {
        $kind = 'b';
    } elseif ($r->getAttribute('isdevice') === 'yes' || $r->getAttribute('runnable') === 'no') {
        $kind = 'd';
    } elseif ($r->getAttribute('ismechanical') === 'yes') {
        $kind = 'm';
    }
    $parent = strtolower((string) $r->getAttribute('cloneof'));
    $m = simplexml_load_string($r->readOuterXml(), 'SimpleXMLElement', LIBXML_NONET | LIBXML_PARSEHUGE);
    $r->next();                                  // past this machine's own lines
    if ($m === false || $short === '') {
        continue;
    }
    $title = trim((string) preg_replace('/\s+/', ' ', (string) $m->description));
    if ($kind === 'g') {
        $coins = (int) ($m->input['coins'] ?? 0);
        $takes = isset($m->softwarelist);
        foreach ($m->device as $d) {
            $takes = $takes || in_array((string) $d['type'], $media, true);
        }
        if ($takes && $coins === 0) {
            $kind = 's';
        }
    }
    $count[$kind]++;
    $rows[$short] = $short . "\t" . str_replace("\t", ' ', $title) . "\t" . $kind . "\t" . $parent;
}
$r->close();
if (isset($exe)) {
    @unlink($xml);
}
if (count($rows) < 5000) {
    fwrite(STDERR, 'only ' . count($rows) . " machines read: that is not MAME's whole list, nothing written\n");
    exit(1);
}
ksort($rows, SORT_STRING);
if (!is_dir($out) && !mkdir($out, 0777, true)) {
    fwrite(STDERR, "could not make $out\n");
    exit(1);
}
$text = "# short\ttitle\tkind\tparent\t(" . $build . ")\n" . implode("\n", $rows) . "\n";
file_put_contents($out . DIRECTORY_SEPARATOR . 'names.tsv.gz', gzencode($text, 9));
$about = "The names of arcade sets\r\n"
    . "========================\r\n\r\n"
    . "names.tsv.gz is the list Scan for Games reads to know what an arcade\r\n"
    . "game's file is: kof2003.zip is \"The King of Fighters 2003\", neogeo.zip is\r\n"
    . "a BIOS set and not a game. Four facts a machine: its short name, its\r\n"
    . "title, what kind of thing it is, and its parent.\r\n\r\n"
    . "Where it comes from\r\n"
    . "-------------------\r\n"
    . "MAME's own list of machines (mame -listxml), MAME " . $build . ".\r\n"
    . "MAME is made by the MAME team, https://www.mamedev.org, and distributed\r\n"
    . "under the GNU General Public License, version 2 or later, with most of\r\n"
    . "its source under the BSD 3-Clause licence. MAME is a registered trademark\r\n"
    . "of Gregory Ember. Xsegon comes with no MAME and no arcade games.\r\n\r\n"
    . count($rows) . ' machines: ' . $count['g'] . ' games, ' . $count['b'] . ' BIOS sets, ' . $count['d'] . " devices,\r\n"
    . $count['m'] . ' mechanical machines, ' . $count['s'] . " computers and consoles.\r\n\r\n"
    . "A newer list: php tools\\get-arcade-names.php --mame <a newer mame.exe>\r\n";
file_put_contents($out . DIRECTORY_SEPARATOR . 'ABOUT.txt', $about);
echo 'MAME ' . $build . ': ' . count($rows) . ' machines (' . $count['g'] . ' games, ' . $count['b'] . ' BIOS sets, ' . $count['d'] . ' devices, '
    . $count['m'] . ' mechanical, ' . $count['s'] . ' computers and consoles), ' . round(filesize($out . DIRECTORY_SEPARATOR . 'names.tsv.gz') / 1024) . " KB\n";
