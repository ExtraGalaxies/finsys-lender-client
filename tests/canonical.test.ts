import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveCanonicalValue, resolveCanonicalEnvelope } from '../src/canonical.js'
import type { CanonicalView } from '../src/types.js'

/**
 * SYS-3416 — the instance-selection rules.
 *
 * These are pinned because they are the part every consumer would otherwise
 * derive independently, and the differences would be SILENT: picking the wrong
 * instance yields a plausible value, not an error. A lender scoring against the
 * wrong phone number or the wrong month's balance gets a wrong decision with
 * every success signal true.
 *
 * This is also the package's first test. It shipped to third parties with none,
 * and the resolver is subtle enough that "it compiles" is not evidence.
 */

const view = (instances: Array<Record<string, unknown>>): CanonicalView =>
  ({
    ihsId: 1,
    categories: {
      'applicant-contact': { cardinality: 'multi', instances },
    },
  }) as unknown as CanonicalView

const inst = (key: string, value: string, observedAt?: string) => ({
  instanceKey: key,
  adapterId: 'applicant-contact-form-v1',
  adapterVersion: 1,
  ...(observedAt ? { observedAt } : {}),
  fields: { contactValue: { value, confidentiality: 'sensitive' } },
})

test('an explicit instanceKey selects that instance, not the newest', () => {
  const v = view([
    inst('mobile', '+60111111111', '2026-01-01T00:00:00.000Z'),
    inst('email', 'a@b.test', '2026-08-01T00:00:00.000Z'),
  ])
  // The email instance is newer. Asking for mobile must still get mobile —
  // otherwise a keyed address silently degrades into latest-wins.
  assert.equal(
    resolveCanonicalValue(v, {
      category: 'applicant-contact',
      field: 'contactValue',
      instanceKey: 'mobile',
    }),
    '+60111111111',
  )
})

test('no instanceKey means latest by observedAt — v1 flat-mirror behaviour', () => {
  const v = view([
    inst('a', 'older', '2026-01-01T00:00:00.000Z'),
    inst('b', 'newer', '2026-08-01T00:00:00.000Z'),
    inst('c', 'middle', '2026-04-01T00:00:00.000Z'),
  ])
  assert.equal(
    resolveCanonicalValue(v, { category: 'applicant-contact', field: 'contactValue' }),
    'newer',
  )
})

test('an undated instance never displaces a dated one', () => {
  // Treating undated as newest would let an unattributed row win; dropping it
  // would lose a fact with nowhere else to be read from. It sorts last.
  const v = view([inst('a', 'dated', '2026-01-01T00:00:00.000Z'), inst('b', 'undated')])
  assert.equal(
    resolveCanonicalValue(v, { category: 'applicant-contact', field: 'contactValue' }),
    'dated',
  )
})

test('an undated instance is still returned when it is all there is', () => {
  const v = view([inst('b', 'undated')])
  assert.equal(
    resolveCanonicalValue(v, { category: 'applicant-contact', field: 'contactValue' }),
    'undated',
  )
})

test('instances that lack the requested field are not candidates', () => {
  // The newest instance carries a DIFFERENT field. Selecting it and then
  // reading undefined would report "no data" for a fact that is present.
  const v = view([
    inst('mobile', '+60111111111', '2026-01-01T00:00:00.000Z'),
    {
      instanceKey: 'emergency',
      adapterId: 'applicant-contact-form-v1',
      adapterVersion: 1,
      observedAt: '2026-08-01T00:00:00.000Z',
      fields: { contactName: { value: 'Someone', confidentiality: 'sensitive' } },
    },
  ])
  assert.equal(
    resolveCanonicalValue(v, { category: 'applicant-contact', field: 'contactValue' }),
    '+60111111111',
  )
})

test('an absent category, field or instance resolves to undefined, not a throw', () => {
  const v = view([inst('mobile', '+60111111111', '2026-01-01T00:00:00.000Z')])
  const base = { category: 'applicant-contact', field: 'contactValue' }
  assert.equal(resolveCanonicalValue(v, { ...base, category: 'nope' }), undefined)
  assert.equal(resolveCanonicalValue(v, { ...base, field: 'nope' }), undefined)
  assert.equal(resolveCanonicalValue(v, { ...base, instanceKey: 'nope' }), undefined)
  // And undefined deliberately does NOT distinguish "withheld" from "never
  // produced" — the API refuses that distinction, because an absence meaning
  // "withheld" would itself disclose that the data exists.
})

test('a tie in observedAt resolves to the FIRST instance in array order', () => {
  // Undocumented until now: the comparison is strict `>`, so an equal-
  // timestamp candidate never displaces the one already held. Pinning array
  // order, not just "a" tie-break, so a future change to the comparison is
  // caught here rather than discovered downstream.
  const v = view([
    inst('first', 'A', '2026-01-01T00:00:00.000Z'),
    inst('second', 'B', '2026-01-01T00:00:00.000Z'),
  ])
  assert.equal(
    resolveCanonicalValue(v, { category: 'applicant-contact', field: 'contactValue' }),
    'A',
  )
})

test('reversing the tied instances flips the winner — it is array order, not instanceKey', () => {
  const v = view([
    inst('second', 'B', '2026-01-01T00:00:00.000Z'),
    inst('first', 'A', '2026-01-01T00:00:00.000Z'),
  ])
  assert.equal(
    resolveCanonicalValue(v, { category: 'applicant-contact', field: 'contactValue' }),
    'B',
  )
})

test('the envelope form keeps provenance around the value', () => {
  const v = view([inst('mobile', '+60111111111', '2026-01-01T00:00:00.000Z')])
  const env = resolveCanonicalEnvelope(v, {
    category: 'applicant-contact',
    field: 'contactValue',
    instanceKey: 'mobile',
  })
  assert.equal(env?.value, '+60111111111')
  assert.equal(env?.confidentiality, 'sensitive')
})
