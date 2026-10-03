# Metaflow v0.2.1 technical plan

The existing Inbox → stability → inspection → date rules → review → history → Undo pipeline shares renaming, duplicate checks and execution with Workspace transfers. Execution remains manually confirmed. No generic JavaScript filesystem or shell capability is exposed.

## Boundaries and models

React features: inbox, date-rules, organizer, history, explorer, workspace, rename, duplicates and settings. Existing Explorer components/store factory remain reusable for later dual-pane instances. Zustand owns UI state, Zod validates typed IPC and errors become centralized Spanish copy. Commands use spawn_blocking, services implement policy and repositories persist it. A shared operation gate serializes configuration, scans, reviews, execution and Undo. Atomic cancellation is independent of the gate. One expiring immutable plan is held in runtime; clients execute its opaque id.

Migration 001 retains inboxes, date_rules, files, settings, operations and JSON operation_items. Migration 002 adds workspaces, workspace_roots and workspace_favorites with workspace foreign keys. A default Workspace is active; roots have independent canonical paths, stable ids and names. Foreign keys are enabled on every connection; WAL, FULL synchronization and busy timeout remain. Reopening does not reset the version.

RenameConfiguration stores presets, Inbox default and rule bindings in settings without restructuring DateRule. Rule bindings override Inbox defaults. Additive HistoryItem kind, entry_kind, undo_path and recovery_parent fields have serde defaults for v0.1 JSON. Source/destination paths preserve original/final names; hash, dates, reason, result and identity stay in the same journal.

Roots restore grants at startup without enumerating contents. Tree expansion calls shallow read_directory. Removing a root changes only its reference. Manual mutations require a persisted root, even if an older native grant remains. Folder moves remap descendant roots/favorites after source removal. Per-item/status markers replay missing reference changes on startup.

## Inbox and names

The nonrecursive notify watcher, polling, three-second stability window, temporary-download handling and bounded retries are preserved. Inclusive local-calendar rules reject overlaps and ambiguous matches across date sources. Unmatched files stay in Inbox.

rename-engine generates Windows-valid names, preserving extensions. Tokens: name, period, year, month, formatted date and padded counter. Date formats: yyyy-MM-dd and yyyyMMdd. Case, spacing and optional accent removal are shared by Inbox and Workspace, including renaming a batch within its current directory. Invalid characters are removed; reserved, empty and overlong names are rejected. Counters start at one per review. Preview never mutates files.

## Duplicates

duplicate-service builds a per-request metadata index of managed roots, Inbox and rule destinations. It coalesces overlapping paths, avoids reparse points and excludes .metaflow-recovery. Recursion happens on explicit scans/reviews, never at startup. Unreadable counts reach the UI.

Candidates match size, then a digest of size plus first/last 64 KiB. Full BLAKE3 confirms equal samples under exclusive read handles. Comparisons are cached within a preview. Equal names do not imply equal contents. Incoming files are hashed for journal integrity; candidates avoid full hashes unless needed.

file-operation-service resolves policy into ordered steps. Skip/keep-existing leave incoming files untouched. Keep-both picks a vacant suffix if needed. Keep-incoming stages old copies and uses the incoming name; replace-existing stages an old copy and uses its path. Name replacement stages the old target. UUID backups beside sources stay in the batch journal. Planned duplicates within the batch support keep-both/skip; replacing a target not yet created is explicitly rejected.

The Duplicates view groups hashes and previews moving other copies to recovery after selecting a keeper. Each retirement revalidates and holds the keeper. A changed/missing keeper prevents retirement. No automatic duplicate deletion occurs.

## Execution, folders and Undo

One IPC creates the batch journal, executes steps and emits counts, bytes and current name. Inbox callbacks revalidate date rules; Workspace callbacks check scope. Both share transfer primitives. Late conflicts never overwrite. Cancel finishes the current file and cancels remaining steps; no pause is offered.

Same-volume Windows Move uses a locked source handle and FileRenameInfo without replacement. Cross-volume Move and Copy create an exclusive new destination, stream, flush, verify size/full BLAKE3 and preserve file timestamps/attributes. Move removes the source only after verification. Alternate streams, encryption, compression and sparse data reject copying/cross-volume moves. Uncertain partial targets remain visible for recovery.

Folder transfers flatten a selected tree into preorder mkdir, file operations and reverse rmdir. Empty directories are preserved. Directory handle identities are recorded. Removal requires emptiness/identity, with Windows handle deletion guarding concurrent arrivals. No recursive deletion is used. Copy Undo stages copies outside created trees so empty directories can be removed while recovery copies remain. Directory ACL/metadata replication is outside current guarantees.

Undo reverses completed steps. Moves require unchanged content/identity/modification time and a vacant source. Copy Undo preserves originals and stages copies. Backups restore after incoming files are undone. New/edited files remain intact and produce partial results.

Startup examines all incomplete entries, independent of the visible 100-operation limit. Hashes reconcile unambiguous moves/copies and copy Undo. Ambiguous paths and interrupted directory steps require manual recovery. Marker replay repairs navigation references after completed folder operations. Recovery copies are retained indefinitely.

## Filesystem date correction

The metadata feature accepts a selection of files/folders or one folder with optional recursion. Preview is bounded to 100,000 visited entries, canonicalizes persisted Workspace/Inbox/rule scopes, rejects reparse points and excludes .metaflow-recovery. Duplicate paths and hard-link identities are coalesced; matching dates and unavailable files are skipped with visible reasons. No file content is read or rewritten.

file-date-service opens an exclusive handle with FILE_READ_DATA, FILE_READ_ATTRIBUTES and FILE_WRITE_ATTRIBUTES. Read-data permission enables Windows sharing checks to reject active content handles, but content is never read. GetFileTime records exact creation and last-write ticks. SetFileTime receives only a last-write pointer, preserving creation and access. No content-write or delete rights are requested. Timestamp readback detects precision limitations.

DateChange is an additive, serde-defaulted journal field. FILETIME integers serialize as decimal strings to preserve 100ns precision across JavaScript and SQLite. Metadata uses the existing single-use preview, shared executor, complete pre-mutation batch journal, per-item pending markers, progress, cancellation and history. Counts are reported without misleading content-transfer byte totals. Identity, size, exact creation and expected modification are revalidated under the handle before apply/Undo. Undo writes the exact former modification; it does not create recovery copies or relocate files. Startup reconciles pending and undo-pending states from exact timestamps, leaving ambiguous results for manual recovery.

Only the current Windows creation time is used. Original dates lost during cloud upload are not reconstructed. EXIF/QuickTime timestamps and directory dates are outside this operation.

## Validation and future work

Generated fixtures cover previous Inbox behavior, date presets, locks, scope, stale plans, Unicode rename buffers, migration, progressive hashes, conflicts, backups, cancellation, folder arrivals and root/favorite remapping across restart. Cross-volume batches include 1, 100 and 5,000 files with bytes/content checks and Undo. The 150-file classification regression remains covered.

Generated metadata fixtures verify a 120-file mixed-extension batch with exact apply/Undo, creation/access/content preservation, direct selection, recursion, recovery exclusions, cancellation, stale 100ns dates, locked files, root removal and interrupted journal recovery.

Deferred: Workspace selection UI, independent dual-pane components, recent folders, arbitrary timestamp editing, EXIF/QuickTime editing, ExifTool, advanced rules and automatic execution. Models/services provide extension points without presenting unfinished flows.
