# Changelog

All notable changes to `@finsys/lender-client` are documented here.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Entries start at 2.5.0 — the release that introduced this file. Earlier
versions are described by their GitHub Releases.

## [Unreleased]

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
