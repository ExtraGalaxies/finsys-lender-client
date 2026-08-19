import type { CanonicalAddress, CanonicalView, CanonicalInstance } from './types.js'

/**
 * SYS-3416 — resolve a canonical address against a v2 response.
 *
 * WHY THIS SHIPS IN THE SDK RATHER THAN BEING LEFT TO CALLERS. Instance
 * selection is the part every consumer gets subtly different from every other
 * consumer, and the differences are silent — a wrong instance is a plausible
 * value, not an error. One implementation, used by everyone, is the only way
 * the migration produces one answer.
 *
 * Two rules, and only two:
 *
 *   address.instanceKey present -> that exact instance.
 *   absent                      -> latest by observedAt.
 *
 * The second is not invented. It is what v1's flat mirror actually did: the
 * wide row could hold one value per field, so a multi-instance category was
 * collapsed latest-wins on the way in. Encoding it here means a consumer
 * migrating off a flat column keeps the behaviour it had, rather than silently
 * acquiring a different one.
 *
 * Returns `undefined` when the fact is not present. That deliberately does NOT
 * distinguish "you are not authorised to see it" from "it was never produced" —
 * the API refuses to make that distinction, because absence that meant
 * "withheld" would itself disclose that data exists.
 */
export function resolveCanonicalValue(
  view: CanonicalView,
  address: CanonicalAddress,
): number | boolean | string | undefined {
  return resolveCanonicalEnvelope(view, address)?.value
}

/** As `resolveCanonicalValue`, but keeps the provenance around the value. */
export function resolveCanonicalEnvelope(view: CanonicalView, address: CanonicalAddress) {
  const category = view.categories?.[address.category]
  if (!category) return undefined

  const candidates = (category.instances ?? []).filter(
    (i) => i.fields?.[address.field] !== undefined,
  )
  if (candidates.length === 0) return undefined

  const chosen =
    address.instanceKey !== undefined
      ? candidates.find((i) => i.instanceKey === address.instanceKey)
      : latestByObservedAt(candidates)

  return chosen?.fields[address.field]
}

/**
 * Undated instances sort LAST rather than being dropped. An instance with no
 * observedAt is still a fact; treating it as newest would let an unattributed
 * row displace a dated one, and dropping it would lose data that has nowhere
 * else to be read from.
 *
 * Comparison is lexicographic on the ISO string, which is correct only for
 * Z-suffixed UTC — which is what the API emits.
 *
 * A tie in observedAt resolves to the FIRST instance in array order: the
 * comparison is strict `>`, so a later candidate with an equal timestamp
 * never displaces the one already held. This is undocumented behavior being
 * pinned, not a new design choice — callers relying on array order for a tie
 * should know it before it changes under them.
 */
function latestByObservedAt(instances: CanonicalInstance[]): CanonicalInstance | undefined {
  let best: CanonicalInstance | undefined
  for (const i of instances) {
    if (!i.observedAt) {
      best ??= i
      continue
    }
    if (!best?.observedAt || i.observedAt > best.observedAt) best = i
  }
  return best
}
