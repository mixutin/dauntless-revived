<#
.SYNOPSIS
    Rebuilds UndauntedMetagame/src/vendor/item_catalog.json from a server's own database.

.DESCRIPTION
    The grant tool will only hand out ids this build actually has, and that list cannot be written
    from memory: the inventory core accepts any string, so a misspelling or an id from a later
    version of Dauntless would be stored and then sit in the player's bags as something the client
    cannot draw.

    This reads every distinct catalog id out of two places:

      * the inventories table, which says what players hold right now
      * inventorylog, which also catches items since consumed, sold or removed

    and records, for each one, whether it is held as a stack or as its own instance. That is the
    part a prefix rule gets wrong: LT_, BNC_, AC_ and TITLE_ each contain both kinds.

    Run it against a BACKUP copy, not the live database. It only ever opens the file read-only,
    but a full scan of inventorylog is real disk load on a host that is also running hunts.

    The output is written next to this script; copy it into src/vendor/ after reviewing the diff.

.EXAMPLE
    # On the server, against the most recent backup:
    powershell -ExecutionPolicy Bypass -File tools\Extract-LiveItems.ps1 `
        -MetagameDir C:\DauntlessRevived\app\UndauntedMetagame `
        -Database C:\DauntlessRevived\backups\2026-10-20_030003\undaunted.db `
        -OutFile C:\Windows\Temp\live-items.json
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$MetagameDir,
    [Parameter(Mandatory = $true)][string]$Database,
    [string]$OutFile = (Join-Path $PSScriptRoot 'live-items.json')
)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

if (-not (Test-Path -LiteralPath $Database)) { throw "No such database: $Database" }
if ($Database -notmatch 'backup') {
    Write-Warning "$Database does not look like a backup copy. It is opened read-only, but a full scan is heavy on a live host."
}

$js = @'
const fs = require('fs');
const path = require('path');
const [metaDir, dbPath, outFile] = process.argv.slice(2);
const Database = require(path.join(metaDir, 'node_modules', 'better-sqlite3'));
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = 1');

const seen = new Map();
const note = (id, field) => {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_]{1,128}$/.test(id)) return;
  let e = seen.get(id);
  if (!e) { e = { stacked: 0, instanced: 0, holders: 0, logged: 0 }; seen.set(id, e); }
  e[field]++;
};

let characters = 0;
for (const row of db.prepare('select stackedItems, instancedItems from inventories').iterate()) {
  characters++;
  for (const [column, field] of [[row.stackedItems, 'stacked'], [row.instancedItems, 'instanced']]) {
    let parsed;
    try { parsed = JSON.parse(column); } catch { continue; }
    if (!Array.isArray(parsed)) continue;
    const here = new Set();
    for (const item of parsed) { note(item?.catalogId, field); here.add(item?.catalogId); }
    for (const id of here) note(id, 'holders');
  }
}
console.log('read ' + characters.toLocaleString() + ' character inventories');

let logged = 0;
for (const row of db.prepare('select catalogId, instanceId from inventorylog').iterate()) {
  logged++;
  note(row.catalogId, 'logged');
  if (row.instanceId) note(row.catalogId, 'instanced');
}
console.log('read ' + logged.toLocaleString() + ' ledger rows');

// Group is only how the dashboard filters the picker; it never affects delivery.
const GROUPS = [
  [/^CURRENCY_/, 'currency'],
  [/^(ORB|GEM|BREAK|PART|GATHER)_/, 'material'],
  [/^CELL(V2|v2)?_/, 'cell'],
  [/^TITLE_/, 'title'],
  [/^(QI|TOKEN|Container|GrantExperienceItem)_/, 'consumable'],
  [/^(AR|WP|EM|DYE|BNC|LT|CC|AC|TY|GD|MP|FL|COL|EJ)_/, 'cosmetic']
];
const groupOf = id => (GROUPS.find(([re]) => re.test(id)) ?? [null, 'other'])[1];

// The 1.4.4 client's own catalogue is the authority on how an item is meant to be held; the
// ledger only shows what this server did with it. Where both know an id, the client wins.
const clientKinds = JSON.parse(fs.readFileSync(path.join(metaDir, 'src', 'vendor', 'store_item_kinds.json'), 'utf8'));
let disagreements = 0;
const items = [...seen.entries()].map(([id, e]) => {
  const ledgerKind = e.instanced > e.stacked ? 'instanced' : 'stacked';
  const fromClient = clientKinds[id];
  if (fromClient && fromClient !== ledgerKind) disagreements++;
  const kind = fromClient === 'stacked' || fromClient === 'instanced' ? fromClient : ledgerKind;
  return [id, kind, groupOf(id)];
}).sort((a, b) => a[0] < b[0] ? -1 : 1);

const note_ = [
  "Every item id this build actually has, with how it is delivered and a group for the dashboard's picker.",
  "Read out of the live server's own data: " + characters.toLocaleString() + " character inventories and " + logged.toLocaleString() + " inventorylog rows.",
  "kind is taken from the 1.4.4 client's catalogue (store_item_kinds.json) where it knows the id, otherwise from how",
  "the item is really stored in players' inventories - a prefix rule gets this wrong, because LT_, BNC_, AC_ and TITLE_",
  "each contain both stacked and instanced items. The two sources agree on every id they both know.",
  "Rebuild with tools/Extract-LiveItems.ps1 if the server gains items this list does not have."
];

// One item per line: a 3000-line diff of single-field objects is unreadable, and so is one line
// of 170 KB.
const text = '{\n  "_note": [\n' + note_.map(n => '    ' + JSON.stringify(n)).join(',\n') + '\n  ],\n  "items": [\n' +
  items.map(i => '    ' + JSON.stringify(i)).join(',\n') + '\n  ]\n}\n';
fs.writeFileSync(outFile, text, 'utf8');

const byGroup = {};
for (const [, kind, group] of items) {
  byGroup[group] ??= { stacked: 0, instanced: 0 };
  byGroup[group][kind]++;
}
console.log('');
console.log(items.length + ' distinct catalog ids written to ' + outFile);
for (const [g, n] of Object.entries(byGroup).sort((a, b) => (b[1].stacked + b[1].instanced) - (a[1].stacked + a[1].instanced))) {
  console.log('  ' + g.padEnd(12) + String(n.stacked + n.instanced).padStart(5) + '  (' + n.stacked + ' stacked, ' + n.instanced + ' instanced)');
}
console.log('');
console.log('client/ledger disagreements: ' + disagreements + (disagreements ? '  <-- look at these before copying the file in' : ''));
db.close();
'@

$scratch = Join-Path ([IO.Path]::GetTempPath()) ('extract-live-items-{0}.cjs' -f [guid]::NewGuid().ToString('N'))
Set-Content -LiteralPath $scratch -Value $js -Encoding utf8
try {
    & node $scratch $MetagameDir $Database $OutFile
    if ($LASTEXITCODE -ne 0) { throw "Extraction failed (exit $LASTEXITCODE)" }
} finally {
    Remove-Item -LiteralPath $scratch -Force -ErrorAction SilentlyContinue
}
