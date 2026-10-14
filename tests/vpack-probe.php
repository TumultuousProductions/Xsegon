<?php
/**
 * A video package for the tests, in the form Import Xsegon Video Package reads:
 *
 *   php tests\vpack-probe.php <out.zip> <manifest.json> <name in zip> <file> [<name in zip> <file> ...]
 *
 * Written with Xsegon's own zip writer (includes\zipstore.php), the manifest last,
 * as a package made on another PC has it. Says "ok" or why not.
 */
declare(strict_types=1);

require_once __DIR__ . '/../includes/videopack.php';

$args = array_slice($argv, 1);
if (count($args) < 2 || count($args) % 2 !== 0) {
    fwrite(STDERR, "php tests\\vpack-probe.php <out.zip> <manifest.json> [<name> <file> ...]\n");
    exit(2);
}
[$out, $manifest] = [$args[0], $args[1]];
$zip = xs_zs_begin($out, $why);
if ($zip === null) {
    echo 'could not begin: ' . $why;
    exit(1);
}
for ($i = 2; $i < count($args); $i += 2) {
    $got = xs_zs_put_file($zip, $args[$i], $args[$i + 1], null, $why);
    if ($got !== 'ok') {
        echo $args[$i] . ': ' . $got . ' ' . $why;
        exit(1);
    }
}
if (!xs_zs_put_bytes($zip, XS_VP_MANIFEST, (string) file_get_contents($manifest)) || !xs_zs_end($zip)) {
    echo 'could not finish';
    exit(1);
}
echo 'ok';
