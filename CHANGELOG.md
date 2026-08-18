# Changelog

All notable changes to `@finsys/lender-client` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries start at 2.5.0 — the release that introduced this file. Earlier
versions are described by their GitHub Releases.

## [Unreleased]

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
