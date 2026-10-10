# NA and inventory-authority rollout

The `us` region adds strict US worker routing, persisted region preferences and a North America choice in launcher 0.1.34. Configure `US_DEPLOYSERVER_URL` as a loopback tunnel and `US_PUBLIC_HOST` as its expected game address. Do not enable selection before native readiness and player connectivity checks pass.

Inventory mutations derive ownership from authenticated context. Ordinary client sessions cannot submit arbitrary raw grant/update/delete transactions; trusted native server requests and internal gameplay controllers retain their reward paths. Source labels do not authorize grants. Regression tests cover the supplied unlocker's mutation families and purchase replay/ownership checks. This does not assert that every possible cheat or progression path is audited.

Migrations 0027 and 0028 add recovery proof/challenge/epoch tables and rebuild the region constraint while copying existing preferences. Back up and verify the database and configuration before restarting the backend. Leave the recovery service secret unset until its private-delivery and session-revocation behavior is validated in staging.

`Prune-DatabaseBackups.ps1 -BackupRoot <backup-directory>` removes database backup files older than 48 hours, skips reparse points and preserves other configuration files. Run it hourly as a scheduled task. Never pass a directory containing the active database. Use `-WhatIf` to review candidates.

Validation: 751 backend tests, 88 deploy tests, 39 bot tests and 251 launcher tests passed (3 launcher tests skipped); TypeScript checks and backend/deploy builds passed. A retention fixture verifies age filtering, configuration preservation and non-mutating WhatIf.

Deploy worker runtime/DLL changes before enforcing native authentication in the backend. Stage artifacts alongside existing files, preserve previous code/configuration, stop affected services during replacement, then check loopback health, native listen readiness, external allowlist connectivity and disposable-account progression. Roll back code and configuration on failed checks; schema rollback requires restoring the verified pre-migration database with all writers stopped, never overwriting a running database.
