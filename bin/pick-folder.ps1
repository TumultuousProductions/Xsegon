<#
    Xsegon - the Windows "choose a folder" window, for the first-run guide.

        powershell -STA -File bin\pick-folder.ps1 -Out data\pick-folder.json -Title "..."

    Started by api\pick-folder.php and left running on its own: the PHP
    server answers one request at a time, so a window waiting inside a request
    would freeze Xsegon. The answer goes into -Out, which the page polls.

    An invisible form kept on top owns the window, so it opens in front of
    Xsegon's full-screen window.
#>

param(
    [Parameter(Mandatory = $true)][string] $Out,
    [string] $Title = 'Choose the folder your games are in',
    # 'file' opens the Windows "open a file" window instead: a path is never
    # typed, so a program is chosen here too.
    [string] $Kind  = 'folder',
    # Where the window starts: the folder or file chosen before, if any.
    [string] $Start = '',
    # What the file window lists first: 'sounds', 'lists', 'packages', or programs when not said.
    [string] $Types = ''
)

$utf8 = New-Object System.Text.UTF8Encoding($false)
function Answer($obj) { [IO.File]::WriteAllText($Out, ($obj | ConvertTo-Json), $utf8) }

try {
    Add-Type -AssemblyName System.Windows.Forms
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true
    $owner.ShowInTaskbar = $false
    $owner.WindowState = 'Minimized'
    $owner.Show()
    $owner.Hide()

    $picked = ''
    if ($Kind -eq 'file') {
        $dlg = New-Object System.Windows.Forms.OpenFileDialog
        $dlg.Title = $Title
        $dlg.CheckFileExists = $true
        $dlg.Multiselect = $false
        $dlg.Filter = if ($Types -eq 'sounds') { 'Sounds (*.wav;*.ogg;*.mp3)|*.wav;*.ogg;*.mp3|All files (*.*)|*.*' }
                      elseif ($Types -eq 'lists') { 'Lists of games (*.json)|*.json|All files (*.*)|*.*' }
                      elseif ($Types -eq 'packages') { 'Video packages (*.zip)|*.zip|All files (*.*)|*.*' }
                      else { 'Programs (*.exe;*.bat;*.cmd;*.lnk)|*.exe;*.bat;*.cmd;*.lnk|All files (*.*)|*.*' }
        try {
            if ($Start) {
                $dir = if (Test-Path -LiteralPath $Start -PathType Container) { $Start } else { Split-Path -Parent $Start }
                if ($dir -and (Test-Path -LiteralPath $dir)) { $dlg.InitialDirectory = $dir }
            }
        } catch { }
        $result = $dlg.ShowDialog($owner)
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $picked = $dlg.FileName }
    } else {
        $dlg = New-Object System.Windows.Forms.FolderBrowserDialog
        $dlg.Description = $Title
        $dlg.ShowNewFolderButton = $false
        try { if ($Start -and (Test-Path -LiteralPath $Start -PathType Container)) { $dlg.SelectedPath = $Start } } catch { }
        $result = $dlg.ShowDialog($owner)
        if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $picked = $dlg.SelectedPath }
    }
    $owner.Dispose()

    if ($picked) {
        Answer @{ state = 'done'; path = $picked }
    } else {
        Answer @{ state = 'cancelled'; path = $null }
    }
}
catch {
    Answer @{ state = 'failed'; path = $null; error = $_.Exception.Message }
}
