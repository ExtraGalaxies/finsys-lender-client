import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveCanonicalValue as resolveValue250,
  resolveCanonicalEnvelope as resolveEnvelope250,
  type LenderClient as LenderClient250,
} from 'lender-client-2.5.0'
import {
  resolveCanonicalValue,
  resolveCanonicalEnvelope,
  type LenderClient,
  type CanonicalView,
  type CanonicalAddress,
  type CanonicalFieldEnvelope,
  type CanonicalInstance,
  type CanonicalCategory,
  type ApplicationRecord,
} from '../src/index.js'

/**
 * SYS-3334 — the five envelope types moved to @finsys/core and this SDK now
 * re-exports them. This file proves that move changed NOTHING for a consumer
 * of the previous release, in the only place both declarations exist at once:
 * `lender-client-2.5.0` is the published 2.5.0, installed under an alias.
 *
 * WHY THE OLD TYPES ARE DERIVED RATHER THAN IMPORTED. 2.5.0 declared these
 * interfaces and never exported them from its index — `import type
 * { CanonicalView } from '@finsys/lender-client'` was TS2305. So "what a 2.5.0
 * consumer held" is precisely what is derivable from the SDK's own signatures:
 * the return type of getCanonicalView(), the parameter types of the resolvers.
 * Deriving them the same way here is not a workaround; it is the honest
 * statement of the contract 2.5.0 actually published.
 *
 * WHY TWO DIRECTIONS. Old→new catches a member core made required, narrowed,
 * or renamed. New→old catches a member core dropped, widened, or renamed.
 * A member core ADDS as optional passes both — that is additive and allowed.
 * These are compile-time pins: `npm test` runs tsc over this file first, and a
 * failed assignment fails the suite before node ever runs it.
 */

type View250 = Awaited<ReturnType<LenderClient250['getCanonicalView']>>
type Address250 = Parameters<typeof resolveValue250>[1]
type Envelope250 = NonNullable<ReturnType<typeof resolveEnvelope250>>
type Instance250 = View250['categories'][string]['instances'][number]
type Category250 = View250['categories'][string]
type Record250 = Awaited<ReturnType<LenderClient250['getApplicationRecord']>>

/**
 * `[A] extends [B]` rather than `A extends B`: the tuple wrapping stops the
 * conditional distributing over a union, so it answers "is A assignable to B"
 * and nothing subtler. `Assert<T extends true>` fails to compile on `false`.
 */
type Assignable<A, B> = [A] extends [B] ? true : false
type Assert<T extends true> = T

// old → new: nothing a 2.5.0 consumer holds stops being accepted.
type _v1 = Assert<Assignable<View250, CanonicalView>>
type _a1 = Assert<Assignable<Address250, CanonicalAddress>>
type _e1 = Assert<Assignable<Envelope250, CanonicalFieldEnvelope>>
type _i1 = Assert<Assignable<Instance250, CanonicalInstance>>
type _c1 = Assert<Assignable<Category250, CanonicalCategory>>
type _r1 = Assert<Assignable<Record250, ApplicationRecord>>
// new → old: nothing core declares is something 2.5.0 would have refused.
type _v2 = Assert<Assignable<CanonicalView, View250>>
type _a2 = Assert<Assignable<CanonicalAddress, Address250>>
type _e2 = Assert<Assignable<CanonicalFieldEnvelope, Envelope250>>
type _i2 = Assert<Assignable<CanonicalInstance, Instance250>>
type _c2 = Assert<Assignable<CanonicalCategory, Category250>>
type _r2 = Assert<Assignable<ApplicationRecord, Record250>>
// And the client's own v2 signature still returns the (now core-owned) type,
// exactly — not merely something assignable to it.
type _p = Assert<Assignable<Awaited<ReturnType<LenderClient['getCanonicalView']>>, CanonicalView>>
type _q = Assert<Assignable<CanonicalView, Awaited<ReturnType<LenderClient['getCanonicalView']>>>>
// The helper itself must be able to say no, or every line above is vacuous.
type _sanity = Assert<Assignable<{ a: 1 }, { a: 1; b: 2 }> extends false ? true : false>

// Runtime: one fixture, both resolvers, one answer. The compile-time pins
// above are the substance; this exists so the file is never a test that
// "passes" by containing no test.
const fixture: CanonicalView = {
  ihsId: 7,
  categories: {
    'applicant-contact': {
      cardinality: 'multi',
      instances: [
        {
          instanceKey: 'mobile',
          adapterId: 'applicant-contact-form-v1',
          adapterVersion: 1,
          observedAt: '2026-01-01T00:00:00.000Z',
          fields: { contactValue: { value: '+60111111111', confidentiality: 'sensitive' } },
        },
        {
          instanceKey: 'email',
          adapterId: 'applicant-contact-form-v1',
          adapterVersion: 1,
          observedAt: '2026-08-01T00:00:00.000Z',
          fields: { contactValue: { value: 'a@b.test', confidentiality: 'sensitive' } },
        },
      ],
    },
  },
}

test('the same view resolves identically through the 2.5.0 and current resolvers', () => {
  const explicit = { category: 'applicant-contact', field: 'contactValue', instanceKey: 'mobile' }
  const latest = { category: 'applicant-contact', field: 'contactValue' }
  assert.equal(resolveCanonicalValue(fixture, explicit), resolveValue250(fixture, explicit))
  assert.equal(resolveCanonicalValue(fixture, latest), resolveValue250(fixture, latest))
  assert.deepEqual(resolveCanonicalEnvelope(fixture, latest), resolveEnvelope250(fixture, latest))
  // Not vacuous: the two addresses pick different instances.
  assert.equal(resolveCanonicalValue(fixture, explicit), '+60111111111')
  assert.equal(resolveCanonicalValue(fixture, latest), 'a@b.test')
})
