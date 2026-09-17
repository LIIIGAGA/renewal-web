import { test } from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { blankSubscription, demoData, exportCSV, exportJSON, localInput, nextOccurrence, parseImport, rollForward, spendByCurrency, subscriptionSchema, toUTC } from '../lib/subscriptions';

test('month-end anchor survives short months and leap years', () => {
  const s = { ...blankSubscription(), billing_anchor_day: 31, next_billing_at:'2027-01-31T02:00:00.000Z' };
  const feb = nextOccurrence(s); assert.equal(feb, '2027-02-28T02:00:00.000Z');
  assert.equal(nextOccurrence({ ...s, next_billing_at:feb }), '2027-03-31T02:00:00.000Z');
  assert.equal(nextOccurrence({ ...s, next_billing_at:'2028-01-31T02:00:00.000Z' }), '2028-02-29T02:00:00.000Z');
});
test('weekly billing preserves local time through DST', () => {
  const s = { ...blankSubscription(), timezone:'America/New_York',billing_cycle:'weekly' as const,next_billing_at:'2027-03-07T15:00:00.000Z' };
  assert.equal(nextOccurrence(s), '2027-03-14T14:00:00.000Z');
});
test('nonexistent DST time is rejected; Shanghai wall time converts to UTC', () => {
  assert.throws(()=>toUTC('2027-03-14T02:30','America/New_York'));
  const utc = toUTC('2026-10-20T09:30','Asia/Shanghai'); assert.equal(utc,'2026-10-20T01:30:00.000Z'); assert.equal(localInput(utc,'Asia/Shanghai'),'2026-10-20T09:30');
});
test('spending separates currencies and excludes inactive subscriptions', () => {
  const base = { ...blankSubscription(), price:120, currency:'USD' as const, billing_cycle:'yearly' as const };
  const result = spendByCurrency([base,{...base,currency:'GBP'},{...base,active:false}]);
  assert.deepEqual(result,{USD:{monthly:10,yearly:120},GBP:{monthly:10,yearly:120}});
});
test('rollover never invents a payment or advances non-auto subscriptions', () => {
  const old = { ...demoData()[0],next_billing_at:'2026-01-31T02:00:00.000Z',billing_anchor_day:31 };
  assert.equal(rollForward(old,Date.parse('2026-03-01')).next_billing_at,'2026-03-31T02:00:00.000Z');
  assert.equal(rollForward({...old,auto_renew:false},Date.parse('2026-03-01')).next_billing_at,old.next_billing_at);
});
test('JSON and multiline/formula-safe CSV round-trip all fields and strip owner IDs', () => {
  const data = demoData(); data[0].notes='=HYPERLINK("https://example.com")\n第二行,带逗号'; data[0].service_name='+test';
  const expected = data.map(s=>subscriptionSchema.parse(s));
  assert.deepEqual(parseImport(exportJSON(data),'json'),expected);
  assert.deepEqual(parseImport(exportCSV(data),'csv'),expected);
  assert.match(exportCSV(data),/'=HYPERLINK/);
  assert.equal('user_id' in parseImport(exportJSON(data),'json')[0],false);
});
test('imports reject invalid booleans, amount precision, unsafe URLs and unknown schema versions', () => {
  const s = demoData()[0];
  assert.throws(()=>parseImport(JSON.stringify([{...s,auto_renew:'false'}]),'json'));
  assert.throws(()=>parseImport(JSON.stringify([{...s,price:0.001}]),'json'));
  assert.throws(()=>parseImport(JSON.stringify([{...s,cancellation_url:'javascript:alert(1)'}]),'json'));
  assert.throws(()=>parseImport(JSON.stringify({version:2,subscriptions:[s]}),'json'));
});

test('legacy JSON/CSV default to Other; selected categories survive exports',()=>{
  const {category,...legacy}=subscriptionSchema.parse(demoData()[0]);
  assert.equal(parseImport(JSON.stringify([legacy]),'json')[0].category,'其他');
  assert.equal(parseImport(Papa.unparse([legacy]),'csv')[0].category,'其他');
  const rows=demoData();rows[0].category='视频';rows[1].category='音乐';
  assert.deepEqual(parseImport(exportJSON(rows),'json').map(s=>s.category),rows.map(s=>s.category));
  assert.deepEqual(parseImport(exportCSV(rows),'csv').map(s=>s.category),rows.map(s=>s.category));
  assert.throws(()=>parseImport(JSON.stringify([{...legacy,category:'未知'}]),'json'));
});
