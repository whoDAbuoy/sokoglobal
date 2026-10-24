// Run: npx tsx --test lib/shipping/dhl.test.mts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLandedCostRequest, buildRateRequest, combineQuotes, eventStage, isDhlCarrier, originCity, parseLandedCost, parseRates, parseTracking,
  plannedShippingDate, splitByOrigin, suggestedWeightKg, trackingStages, validateQuoteForm, type QuoteGroup, type QuoteLine, type QuoteRequest, type TrackEvent,
} from './dhl.ts';

const quote: QuoteRequest = {
  origin: { countryCode: 'cn', cityName: 'Guangzhou' }, destination: { countryCode: 'KE', cityName: 'Nairobi', postalCode: '00100' },
  parcel: { weightKg: 12.345, lengthCm: 40.2, widthCm: 30, heightCm: 30 }, declaredValueCents: 50_000, accountNumber: '123456789',
  shipDate: new Date('2026-10-23T15:00:00Z'), item: { title: 'Argan oil serum', units: 100, hsCode: '330499' },
};

test('validateQuoteForm accepts a sane parcel and rejects junk per field', () => {
  const ok = validateQuoteForm({ destinationCity: ' Nairobi ', destinationPostalCode: '', weightKg: '12.5', lengthCm: 40, widthCm: '30', heightCm: 30 });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.value, { destinationCity: 'Nairobi', destinationPostalCode: null, parcel: { weightKg: 12.5, lengthCm: 40, widthCm: 30, heightCm: 30 } });
  const bad = validateQuoteForm({ destinationCity: '<x>', destinationPostalCode: '!!', weightKg: 0, lengthCm: 400, widthCm: 'a', heightCm: 10 });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(Object.keys(bad.errors).sort(), ['destinationCity', 'destinationPostalCode', 'lengthCm', 'weightKg', 'widthCm']);
  assert.equal(validateQuoteForm({ destinationCity: 'Dar es Salaam', weightKg: 1, lengthCm: 1, widthCm: 1, heightCm: 1 }).ok, true);
});

test('plannedShippingDate: next weekday 10:00 UTC in MyDHL format', () => {
  assert.equal(plannedShippingDate(new Date('2026-10-21T20:00:00Z')), '2026-10-22T10:00:00 GMT+00:00');   // Wed → Thu
  assert.equal(plannedShippingDate(new Date('2026-10-23T15:00:00Z')), '2026-10-26T10:00:00 GMT+00:00');   // Fri → Mon
  assert.equal(plannedShippingDate(new Date('2026-10-24T09:00:00Z')), '2026-10-26T10:00:00 GMT+00:00');   // Sat → Mon
});

test('buildRateRequest: metric, customs-declarable, USD declared value, rounded package', () => {
  const r = buildRateRequest(quote);
  assert.deepEqual(r.customerDetails.shipperDetails, { postalCode: '', cityName: 'Guangzhou', countryCode: 'CN' });
  assert.deepEqual(r.customerDetails.receiverDetails, { postalCode: '00100', cityName: 'Nairobi', countryCode: 'KE' });
  assert.deepEqual(r.accounts, [{ typeCode: 'shipper', number: '123456789' }]);
  assert.equal(r.unitOfMeasurement, 'metric');
  assert.equal(r.isCustomsDeclarable, true);
  assert.deepEqual(r.monetaryAmount, [{ typeCode: 'declaredValue', value: 500, currency: 'USD' }]);
  assert.deepEqual(r.packages, [{ weight: 12.35, dimensions: { length: 41, width: 30, height: 30 } }]);
});

test('buildLandedCostRequest carries the item, its HS code and customs value', () => {
  const r = buildLandedCostRequest(quote as QuoteRequest & { item: NonNullable<QuoteRequest['item']> }, 'P');
  assert.equal(r.productCode, 'P');
  assert.equal(r.items[0].commodityCode, '330499');
  assert.equal(r.items[0].customsValue, 500);
  assert.equal(r.items[0].unitPrice, 5);
  assert.equal(r.items[0].manufacturerCountry, 'CN');
  const noHs = buildLandedCostRequest({ ...quote, item: { title: 'x', units: 0, hsCode: null } }, 'P');
  assert.equal('commodityCode' in noHs.items[0], false);
  assert.equal(noHs.items[0].quantity, 1);
});

test('parseRates prefers Express Worldwide (P), else the cheapest priced offer', () => {
  const body = { products: [
    { productName: 'EXPRESS 12:00', productCode: 'T', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'USD', price: 180.5 }], deliveryCapabilities: { totalTransitDays: 3 } },
    { productName: 'EXPRESS WORLDWIDE', productCode: 'P', totalPrice: [{ currencyType: 'PULCL', priceCurrency: 'CNY', price: 900 }, { currencyType: 'BILLC', priceCurrency: 'usd', price: 142.1 }],
      deliveryCapabilities: { totalTransitDays: 4, estimatedDeliveryDateAndTime: '2026-10-30T23:59:00' } },
  ] };
  assert.deepEqual(parseRates(body), { productName: 'EXPRESS WORLDWIDE', productCode: 'P', currency: 'USD', freightCents: 14_210, transitDays: 4, estimatedDelivery: '2026-10-30T23:59:00' });
  const noP = { products: [
    { productCode: 'T', totalPrice: [{ price: 99 }] }, { productCode: 'Y', totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'EUR', price: 75 }] }, { productCode: 'Z', totalPrice: [] },
  ] };
  assert.equal(parseRates(noP)?.productCode, 'Y');
  assert.equal(parseRates(noP)?.currency, 'EUR');
  assert.equal(parseRates({}), null);
  assert.equal(parseRates({ products: [{ productCode: 'P', totalPrice: [{ price: 'n/a' }] }] }), null);
  assert.equal(parseRates(null), null);
});

test('parseLandedCost sums duty and tax lines; null when there are none', () => {
  const body = { products: [{ detailedPriceBreakdown: [{ priceCurrency: 'USD', breakdown: [
    { name: 'EXPRESS WORLDWIDE', price: 140 }, { name: 'DUTY', typeCode: 'DUTY', price: 50.25 }, { name: 'VAT', price: 80 },
    { typeCode: 'TAX', name: 'Import Excise', price: 10 }, { name: 'FUEL SURCHARGE', price: 12 },
  ] }] }] };
  assert.deepEqual(parseLandedCost(body), { dutiesCents: 5_025, taxesCents: 9_000, currency: 'USD' });
  assert.equal(parseLandedCost({ products: [{ detailedPriceBreakdown: [{ breakdown: [{ name: 'EXPRESS', price: 10 }] }] }] }), null);
  assert.equal(parseLandedCost('nope'), null);
});

const ev = (at: string, description: string, statusCode: string | null = 'transit', location: string | null = null): TrackEvent => ({ at, description, statusCode, location });

test('eventStage maps DHL checkpoint wording to the five stages', () => {
  assert.equal(eventStage(ev('2026-10-20T08:00:00Z', 'Shipment picked up', 'pre-transit')), 'picked_up');
  assert.equal(eventStage(ev('2026-10-21T08:00:00Z', 'Clearance processing complete at NAIROBI')), 'customs');
  assert.equal(eventStage(ev('2026-10-21T08:00:00Z', 'Departed Facility in HONG KONG')), 'in_transit');
  assert.equal(eventStage(ev('2026-10-22T08:00:00Z', 'Shipment is out with courier for delivery')), 'out_for_delivery');
  assert.equal(eventStage(ev('2026-10-22T08:00:00Z', 'Processed at NAIROBI - KENYA')), 'in_transit');
  assert.equal(eventStage(ev('2026-10-22T08:00:00Z', 'Out for delivery')), 'out_for_delivery');
  assert.equal(eventStage(ev('2026-10-22T15:00:00Z', 'Delivered - Signed for by: A', 'delivered')), 'delivered');
  assert.equal(eventStage(ev('2026-10-22T15:00:00Z', 'Shipment information received', 'pre-transit')), null);
});

test('trackingStages: monotonic, first event wins, current after the last reached', () => {
  const events = [
    ev('2026-10-21T02:00:00Z', 'Departed Facility in HONG KONG', 'transit', 'Hong Kong'),
    ev('2026-10-20T08:00:00Z', 'Shipment picked up', 'pre-transit', 'Guangzhou'),
    ev('2026-10-22T05:00:00Z', 'Arrived at Delivery Facility in NAIROBI', 'transit', 'Nairobi'),
  ];
  const s = trackingStages(events, 'transit');
  assert.deepEqual(s.map((x) => x.state), ['done', 'done', 'done', 'current', 'upcoming']);   // customs implied by reaching transit
  assert.equal(s[0].location, 'Guangzhou');
  assert.equal(s[2].at, '2026-10-21T02:00:00Z');
  assert.equal(s[1].at, null);

  assert.deepEqual(trackingStages([], null).map((x) => x.state), ['upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
  const onlyInfo = trackingStages([ev('2026-10-20T08:00:00Z', 'Shipment information received', 'pre-transit')], 'pre-transit');
  assert.deepEqual(onlyInfo.map((x) => x.state), ['done', 'current', 'upcoming', 'upcoming', 'upcoming']);
  const failed = trackingStages([ev('2026-10-20T08:00:00Z', 'Shipment picked up')], 'failure');
  assert.equal(failed[1].state, 'upcoming');
  const delivered = trackingStages([ev('2026-10-25T10:00:00Z', 'Signed for', 'transit')], 'delivered');
  assert.equal(delivered[4].state, 'done');
});

test('parseTracking reads the first shipment, newest events first, and skips bad timestamps', () => {
  const body = { shipments: [{
    id: '1234567890', service: 'express', estimatedTimeOfDelivery: '2026-10-24T18:00:00Z',
    status: { timestamp: '2026-10-22T05:00:00Z', statusCode: 'transit', status: 'transit', description: 'Arrived at Delivery Facility in NAIROBI' },
    events: [
      { timestamp: '2026-10-20T08:00:00Z', location: { address: { addressLocality: 'GUANGZHOU - CHINA' } }, statusCode: 'transit', description: 'Shipment picked up' },
      { timestamp: 'not a date', description: 'garbage' },
      { timestamp: '2026-10-22T05:00:00Z', location: { address: { addressLocality: 'NAIROBI - KENYA' } }, statusCode: 'transit', description: 'Arrived at Delivery Facility in NAIROBI' },
    ],
  }] };
  const t = parseTracking(body);
  assert.ok(t);
  assert.equal(t.status, 'Arrived at Delivery Facility in NAIROBI');
  assert.equal(t.estimatedDelivery, '2026-10-24T18:00:00Z');
  assert.deepEqual(t.events.map((e) => e.location), ['NAIROBI - KENYA', 'GUANGZHOU - CHINA']);
  assert.equal(t.stages[0].location, 'GUANGZHOU - CHINA');
  assert.equal(parseTracking({ shipments: [] }), null);
  assert.equal(parseTracking(undefined), null);
});

test('originCity: listing attribute first, then the country hub, else null', () => {
  assert.equal(originCity('cn', null), 'Guangzhou');
  assert.equal(originCity('CN', { ship_from_city: ' Yiwu ' }), 'Yiwu');
  assert.equal(originCity('CN', { ship_from_city: 'x' }), 'Guangzhou');
  assert.equal(originCity('ZZ', {}), null);
});

const line = (originCountry: string, goodsCents: number, weight?: number, units = 10): QuoteLine =>
  ({ orderId: `${originCountry}-${goodsCents}`, originCountry, goodsCents, units, title: 't', attributes: weight === undefined ? {} : { weight_kg: weight } });

test('suggestedWeightKg needs a weight on every line', () => {
  assert.equal(suggestedWeightKg([line('CN', 100, 0.32, 10), line('CN', 100, '1.1' as unknown as number, 2)]), 5.5);   // 3.2 + 2.2 = 5.4 kg, up to the next 0.5
  assert.equal(suggestedWeightKg([line('CN', 100, 0.2), line('US', 100)]), null);
  assert.equal(suggestedWeightKg([]), null);
  assert.equal(suggestedWeightKg([line('CN', 100, 50, 100)]), 300);
});

test('splitByOrigin: one parcel per origin, weight split by goods value', () => {
  const parcel = { weightKg: 10, lengthCm: 40, widthCm: 30, heightCm: 30 };
  const g = splitByOrigin([line('CN', 30_000), line('us', 10_000), line('CN', 10_000)], parcel);
  assert.deepEqual(g.map((x) => [x.originCountry, x.lines.length, x.goodsCents, x.parcel.weightKg]), [['CN', 2, 40_000, 8], ['US', 1, 10_000, 2]]);
  assert.equal(g[0].parcel.lengthCm, 40);
  assert.equal(splitByOrigin([line('CN', 0), line('US', 0)], parcel)[1].parcel.weightKg, 5);
});

test('combineQuotes: one currency, all-or-nothing duties, slowest transit', () => {
  const g = (currency: string, freightCents: number, dutiesCents: number | null, transitDays: number | null): QuoteGroup =>
    ({ originCountry: 'CN', originCity: 'Guangzhou', productName: 'EXPRESS WORLDWIDE', currency, freightCents, transitDays, estimatedDelivery: null, dutiesCents, taxesCents: dutiesCents });
  assert.deepEqual(combineQuotes([g('USD', 10_000, 2_000, 3), g('USD', 5_000, 500, 5)]),
    { currency: 'USD', freightCents: 15_000, dutiesCents: 2_500, taxesCents: 2_500, transitDays: 5 });
  const mixed = combineQuotes([g('USD', 10_000, 2_000, 3), g('EUR', 5_000, null, null)]);
  assert.equal(mixed.currency, null);
  assert.equal(mixed.dutiesCents, null);
  assert.equal(mixed.transitDays, null);
  assert.deepEqual(combineQuotes([]), { currency: null, freightCents: 0, dutiesCents: null, taxesCents: null, transitDays: null });
});

test('isDhlCarrier', () => {
  assert.equal(isDhlCarrier('DHL Express'), true);
  assert.equal(isDhlCarrier('dhl'), true);
  assert.equal(isDhlCarrier('Sendy'), false);
  assert.equal(isDhlCarrier('ADHLER Logistics'), false);
  assert.equal(isDhlCarrier(null), false);
});
