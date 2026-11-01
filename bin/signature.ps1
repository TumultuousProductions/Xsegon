<#  bin\signature.ps1 - who signed each file, for a program the Extensions page
    opens (includes\extensions.php). Only reads.

        powershell -NoProfile -ExecutionPolicy Bypass -File bin\signature.ps1 <file> [<file> ...]

    One line for each file, in order: Windows' status, then the signer's
    whole certificate subject, as Valid|CN=Someone, O=Someone. A file Windows
    would not read says Unread.                                               #>

param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Paths)

$ErrorActionPreference = 'Stop'
foreach ($path in $Paths) {
    try {
        $signature = Get-AuthenticodeSignature -LiteralPath $path
        $subject = if ($signature.SignerCertificate) { $signature.SignerCertificate.Subject } else { '' }
        '{0}|{1}' -f $signature.Status, $subject
    } catch {
        'Unread|'
    }
}
