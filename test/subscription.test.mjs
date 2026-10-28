import test from 'node:test';
import assert from 'node:assert/strict';
import {subscriptionFromInput} from '../lib/subscription.mjs';
test('a manually entered period is explicitly identified and date-only',()=>{
  assert.deepEqual(subscriptionFromInput({date:'2028-02-29',kind:'period_end'},123),{date:'2028-02-29',kind:'period_end',source:'manual',updatedAt:123});
});
test('invalid calendar dates, types, and renewal kinds cannot become billing facts',()=>{
  for(const date of ['2026-02-29','2026-04-31','2026-13-01','tomorrow',123])assert.throws(()=>subscriptionFromInput({date,kind:'renewal'}));
  assert.throws(()=>subscriptionFromInput({date:'2026-12-01',kind:'automatic'}));
});
test('a renewal is kept separate from period end and can be cleared',()=>{
  assert.equal(subscriptionFromInput({date:'2026-12-01',kind:'renewal'}).kind,'renewal');
  assert.equal(subscriptionFromInput({date:null}),null);
});
