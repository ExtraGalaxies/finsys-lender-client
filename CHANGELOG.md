# Changelog

All notable changes to `@finsys/lender-client` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries start at 2.5.0 — the release that introduced this file. Earlier
versions are described by their GitHub Releases.

## [2.10.0]

### Added

- **`listApplicationsV2` — the v2 application list (SYS-3615).** `/lender/ihs/list`
  is frozen and unchanged; this is a new method against a new path. It filters and
  sorts by declared SUBJECT LABELS rather than by naming flat `ihs` columns, which
  is what makes a caller survive those columns being dropped. Pagination is KEYSET:
  pass `cursor` from the previous response's `pagination.nextCursor`, and a null
  `nextCursor` means the last page. There is deliberately no `page` and no total
  count — offset paging over a live table returns rows twice and skips others.

- **`ihsId` — filter the list to one application (SYS-3618).** EQUALITY, never a
  range: `ihsId` is the keyset cursor's tiebreaker, so pinning it to one value is
  compatible with every ordering while a range would interact with the cursor
  comparison. Combined with other filters these are ANDed, so an id excluded by one
  of them returns an empty page rather than that application.

  A non-positive or non-integer value is refused HERE rather than sent. The server
  answers such a value with an empty page, not an error, and a well-formed page of
  nothing is indistinguishable from "no such application" for a caller that
  believes it named one — the same reason this SDK already refuses an empty
  `cursor`, an empty label term and an out-of-range `updatedAfter`.

- **Three more sort keys (SYS-3617): `statusDescription`, `programName`,
  `borrowerAgentName`.** The record-plane fields the list already projects.

  **Note the spelling of the last one.** v1 emits this field as `borrowerAgent`;
  the v2 list projects and sorts it as `borrowerAgentName`, and the server REFUSES
  the v1 spelling rather than ignoring it. A filter or sort that is ignored on this
  endpoint does not fail — it answers a wider set — so the refusal is deliberate
  and the type is what keeps a caller from discovering it at runtime.

  All three are nullable, and a null sorts as its own rank rather than wherever the
  engine happens to put it, so a page walk covers a row with no program or no agent
  exactly once.

## [2.8.0]

### Changed

- **`@finsys/core` widens from `^8.1.0` to `^8.1.0 || ^9.0.0` (SYS-3555).**
  Core is a normal `dependency` here, not a peer, so the old range did not
  ERESOLVE — it did something quieter and worse. Measured, not inferred: a
  consumer declaring `@finsys/core@^9.0.0` alongside this SDK at `2.7.0`
  installs **two** copies of core, 9.x at the top level and 8.x nested under
  this package. The five `Canonical*` envelope types this SDK re-exports then
  come from a different core than the consumer's own import of them, so they
  are nominally distinct types that happen to have the same shape. That
  configuration exists today on `finsys-client`'s `integration/SYS-3433`
  branch, which declares core `^9.0.0` and this SDK at `2.7.0`.

  Widening rather than moving to `^9.0.0` outright is deliberate: the range
  still admits 8.x, so this SDK stays installable before core 9.0.0 is cut, and
  there is no window in which the pair cannot co-install. Core 9.0.0 lands as
  one publish at the SYS-3433 integration point; nothing here needs re-editing
  when it does.

  Compatibility with core 9 was measured on the 9.0.0 candidate rather than
  assumed — `tsc --noEmit` clean and 22/22 tests green under both 8.1.2 and
  9.0.0. Core 9.0.0's breaking changes are confined to the `Subject*` surface
  (`SubjectInstance.source`, `subjectViewFromRecords`, raw `instanceKey`); this
  SDK contains zero `Subject` references, and 9.0.0 leaves application-scope
  `CanonicalView` untouched.

## [2.7.0] - 2026-08-18

Additive. No method removed, no signature narrowed — a consumer on 2.6.0
upgrades without touching anything. Depends on `@finsys/core ^8.1.0` for the
two envelope members below.

### Added

- **`getCanonicalView(ihsId, { include?, overlay?: 'mine' })` (SYS-3415).**
  The bare-array form is still accepted as `include`. `overlay: 'mine'`
  projects THIS lender's own staged, uncommitted field edits onto the view —
  what `getApplicationDetails` (v1) always did silently, and what v2 does only
  when asked. An overlaid field carries the staged value as `value`,
  `origin: 'manual'`, and the attested value as `originalValue`; the view
  carries `overlay: {lenderId, applied, updatedAt, unprojected[]}`, so the
  payload SAYS which projection you hold — the gap 2.5.0's notes named.
  Without it the view is facts-only and identical for every lender: another
  lender in the same program never sees your staged edit. `CanonicalViewOptions`
  is exported. A migrating client's edit-mode screens use this; its scoring
  decides deliberately which of the two it wants.

### Fixed (candidate-only — none of these ever shipped)

- **`overlay` values other than `'mine'` were silently dropped** — a JS caller
  passing `'MINE'`, `'true'`, `true`, `1`, `''` got a request with no overlay
  param and a facts-only view while believing it held its staged edits, the
  exact confusion this option exists to end. Now rejected locally with a 400
  `LenderApiError` before any HTTP call, the same precedent as `include: []`.
- **`include` ids were joined and then encoded.** Each id is now encoded
  before joining, so a reserved character in an id (`&`, `#`, `%`, space)
  cannot corrupt the query string. Note the limit of that: it holds on the
  RAW request line only — the server percent-decodes the value before
  splitting on `,`, so a comma-bearing id would still read as two ids
  server-side. Category ids are kebab-case registry slugs and never contain a
  comma, so no real request is affected either way.
- **A trailing slash on an `endpointOverrides` value produced `//`** in the
  path (`/v2/ihs//42`). Normalized.
- Tied `observedAt` resolves to the first instance in array order; now
  documented and pinned.
- New `tests/lender-client-v2.test.ts`: the first HTTP-level tests this
  package has had — a local `node:http` server captures the exact request for
  both v2 methods (URL composition, empty-include in both forms, overlay
  validation, override normalization, and 401 → one re-login → one retry).

## [2.6.0] - 2026-08-18

Additive. No method removed, no signature changed, no behavior altered. New
install-time dependency: `@finsys/core` — which brings its own runtime tree
(`zod`, `ajv`, `ajv-formats`, `semver` and their transitive deps; nine packages
in all). Nothing from any of them executes in this SDK: the import is
`import type` and is erased at build. Stated here because a public package's
dependency tree is the consumer's audit surface.

### Fixed

- **The v2 envelope types are now importable by name (SYS-3334).** 2.5.0
  *declared* `CanonicalView`, `CanonicalCategory`, `CanonicalInstance`,
  `CanonicalFieldEnvelope`, `CanonicalAddress` — and `ApplicationRecord` — but
  never exported them from the package index, so
  `import type { CanonicalView } from '@finsys/lender-client'` was `TS2305`.
  A consumer could hold one only as the unnamed return type of
  `getCanonicalView()`, and had to spell `resolveCanonicalValue`'s address
  argument as an anonymous literal. All six are exported by name from 2.6.0.
  (`ApplicationRecord` stays declared in this package — it is the SDK's
  application record, not part of core's envelope vocabulary.)

### Changed

- **The five `Canonical*` types are owned by `@finsys/core` and re-exported
  here.** They describe the wire shape of a published API and every consumer
  needs them — not only external lenders holding this SDK. Two declarations of
  one wire shape drifting apart, with nothing comparing them, is the defect
  this estate keeps re-finding; so the shape now lives once, in the package
  that already owns the category registry, the field catalogue and the v1
  migration map. `@finsys/core ^8.0.0` becomes a dependency of this package
  for that reason (types only — nothing from core executes at runtime).
  `^8.0.0`, not `^7.10.0`: 7.x's root declaration file re-exported types from
  an optional peer, which failed typechecking for any consumer of THIS package
  on tsc's default `skipLibCheck: false` — found by this release's review and
  fixed in core 8.0.0 (SYS-3420). Consumers should not have to install
  `survey-core` to typecheck a lender SDK.

  `tests/canonical-types-compat.test.ts` installs the published 2.5.0 under an
  alias and proves, at compile time and in **both directions**, that what a
  2.5.0 consumer held is assignable to and from what core now declares — the
  old types derived from 2.5.0's own signatures, because that is precisely
  what 2.5.0 published. Two layers: structural assignability both ways, and
  `keyof` both ways — the second because structural assignability alone is
  blind to OPTIONAL members, and `confidence?`/`origin?`/`runId?` are the
  provenance fields a consumer uses to decide whether to trust a value.
  Mutation-proven against core's installed declarations: a member made
  required, dropped, renamed, widened or narrowed — required or optional —
  each fails the suite. The alias baseline is pinned to 2.5.0 with a runtime
  guard, because a later baseline would make every pin `core extends core`.

## [2.5.0] - 2026-08-18

Additive. No method removed, no signature changed, no behavior altered for
existing calls — a consumer on 2.4.0 upgrades without touching anything.

### Added

- **`getCanonicalView(ihsId, include?)` (SYS-3416)** — the v2 read:
  `GET /lender/v2/ihs/{ihsId}`, returning canonical facts each wrapped in its
  own provenance envelope.

  **It is NOT a drop-in for `getApplicationDetails`, and the difference is the
  point.** That one merges *this lender's* pending edit overlay before
  returning, so its values are the lender's current working values. These are
  the attested facts. Both are defensible inputs to a decision; swapping one
  for the other silently is not.

  `include` narrows to named categories. Omitted, you get every category the
  deployment's registry declares. An **empty** array is refused locally rather
  than sent: the server rejects it, and quietly turning it into "give me
  everything" would make a caller bug indistinguishable from an intentional
  read. An unknown category id is rejected server-side with 400, so a typo
  fails loudly instead of silently narrowing the result.

- **`getApplicationRecord(ihsId)` (SYS-3416)** — `GET /lender/applications/{ihsId}`:
  the facility request, the parties, workflow state, and consent references —
  what the canonical view deliberately omits.

  **A consumer migrating off the v1 flat read needs BOTH of these.** Neither
  alone carries what `GET /lender/ihs/{ihsId}` did, which is why they ship
  together rather than as two releases.

- **`resolveCanonicalValue(view, address)` and `resolveCanonicalEnvelope(view, address)`
  (SYS-3416)** — one shared instance resolver.

  **This ships in the SDK precisely because it is the part every consumer would
  get subtly differently.** A wrongly-selected instance is a plausible value,
  not an error, so the disagreement between two hand-rolled resolvers is
  invisible until someone reconciles two systems. Two rules and only two: an
  explicit `instanceKey` selects that instance; its absence selects the latest
  by `observedAt`.

  Latest-wins is **not invented for v2** — it is what v1's flat mirror already
  did, since a wide row held one value per field and collapsed a multi-instance
  category on the way in. Encoding it here means a consumer migrating off a
  flat column keeps the behavior it had rather than silently acquiring a new
  one. Undated instances sort **last**: treating them as newest would let an
  unattributed row displace a dated one, and dropping them would lose data with
  nowhere else to be read from.

  Both return `undefined` when the fact is absent, and that deliberately does
  **not** distinguish "withheld from you" from "never produced" — the API
  refuses that distinction, because an absence meaning "withheld" would itself
  disclose that the data exists.

### Note for integrators

The published OpenAPI document names the canonical read `getApplicationCanonical`,
while the SDK method is `getCanonicalView`. The operation and the method are the
same thing.
