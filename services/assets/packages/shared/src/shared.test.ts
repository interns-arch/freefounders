import { test } from 'node:test';
import assert from 'node:assert/strict';
import { availableActions, canPerform } from './lifecycle';
import { slugifyKey, validateAttributes, type FieldDef } from './fields';

test('lifecycle: individual asset follows the documented path', () => {
  assert.deepEqual(availableActions({ status: 'PURCHASED', trackingMode: 'INDIVIDUAL' }), ['receive']);
  assert.ok(canPerform('move_to_inventory', { status: 'RECEIVED', trackingMode: 'INDIVIDUAL' }));
  assert.ok(canPerform('assign', { status: 'AVAILABLE', trackingMode: 'INDIVIDUAL' }));
  assert.ok(canPerform('assign', { status: 'IN_INVENTORY', trackingMode: 'INDIVIDUAL' }));
  assert.ok(canPerform('transfer', { status: 'ASSIGNED', trackingMode: 'INDIVIDUAL' }));
  assert.ok(canPerform('return', { status: 'ASSIGNED', trackingMode: 'INDIVIDUAL' }));
  assert.ok(canPerform('make_available', { status: 'RETURNED', trackingMode: 'INDIVIDUAL' }));
  assert.ok(canPerform('dispose', { status: 'RETIRED', trackingMode: 'INDIVIDUAL' }));
});

test('lifecycle: invalid transitions are rejected', () => {
  assert.equal(canPerform('assign', { status: 'ASSIGNED', trackingMode: 'INDIVIDUAL' }), false);
  assert.equal(canPerform('dispose', { status: 'AVAILABLE', trackingMode: 'INDIVIDUAL' }), false);
  assert.equal(canPerform('retire', { status: 'ASSIGNED', trackingMode: 'INDIVIDUAL' }), false);
  assert.deepEqual(availableActions({ status: 'DISPOSED', trackingMode: 'INDIVIDUAL' }), []);
});

test('lifecycle: pooled assets depend on free quantity and allocations', () => {
  const ctx = { status: 'AVAILABLE' as const, trackingMode: 'QUANTITY' as const };
  assert.ok(canPerform('assign', { ...ctx, availableQuantity: 3, activeAllocations: 0 }));
  assert.equal(canPerform('assign', { ...ctx, status: 'ASSIGNED', availableQuantity: 0, activeAllocations: 5 }), false);
  assert.ok(canPerform('return', { ...ctx, availableQuantity: 0, activeAllocations: 1 }));
  assert.equal(canPerform('retire', { ...ctx, availableQuantity: 2, activeAllocations: 1 }), false);
  assert.equal(canPerform('move_to_inventory', { ...ctx, availableQuantity: 2 }), false);
});

const laptopFields: FieldDef[] = [
  { key: 'ram_gb', label: 'RAM (GB)', type: 'number', required: true, min: 1, max: 1024 },
  { key: 'processor', label: 'Processor', type: 'text', required: true },
  { key: 'os', label: 'OS', type: 'select', required: false, options: ['Windows', 'macOS', 'Linux'] },
  { key: 'ports', label: 'Ports', type: 'multiselect', required: false, options: ['USB-C', 'HDMI'] },
  { key: 'purchased_on', label: 'Purchased on', type: 'date', required: false },
  { key: 'touch', label: 'Touch screen', type: 'boolean', required: false },
];

test('fields: valid values are normalised', () => {
  const r = validateAttributes(laptopFields, {
    ram_gb: '16',
    processor: '  Intel i7 ',
    os: 'Windows',
    ports: 'HDMI',
    purchased_on: '2025-02-28',
    touch: 'true',
    unknown_key: 'dropped',
  });
  assert.ok(r.ok);
  if (r.ok) {
    assert.deepEqual(r.value, {
      ram_gb: 16,
      processor: 'Intel i7',
      os: 'Windows',
      ports: ['HDMI'],
      purchased_on: '2025-02-28',
      touch: true,
    });
  }
});

test('fields: required, range, option and date rules produce messages', () => {
  const r = validateAttributes(laptopFields, { ram_gb: '0', os: 'BeOS', purchased_on: '2025-02-30' });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.match(r.errors.ram_gb, /at least 1/);
    assert.match(r.errors.processor, /required/);
    assert.match(r.errors.os, /one of/);
    assert.match(r.errors.purchased_on, /valid date/);
  }
});

test('fields: empty optional values are dropped', () => {
  const r = validateAttributes(laptopFields, { ram_gb: 8, processor: 'M3', os: '', ports: [], purchased_on: '' });
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(r.value, { ram_gb: 8, processor: 'M3' });
});

test('fields: keys are slugified from labels', () => {
  assert.equal(slugifyKey('Engine No.'), 'engine_no');
  assert.equal(slugifyKey('RAM (GB)'), 'ram_gb');
  assert.equal(slugifyKey('4G Support'), 'f_4g_support');
});

test('reconcile: detects the source and joins rows split by line breaks', async () => {
  const { detectSource, extractRows } = await import('./reconcile');
  const H = ['SalaryBox ID', 'Employee Name', 'Employee ID', 'Phone Number', 'Current Address', 'Aadhar', 'PAN', 'x1', 'x2', 'Laptop -', 'SIM Details -', 'Other'];
  const table: unknown[][] = [
    H,
    ['SBAAAAAAAA', 'Asha Rao', 'CT000001', 9811111111, 'Flat 1'],
    ['Sector 5, Delhi', 123412341234, 'ABCDE1234F', null, null, 'LAPTOP-AB12CD3', '9000000771 / 8991000000000000169U', 'Card 4421 4500 0098 9137'],
    ['SBBBBBBBBB', 'Ravi', 'CT0000122', 9822222222, 'One line', null, null, null, null, null, 'NA'],
  ];
  const found = detectSource(table)!;
  assert.deepEqual(found, { source: 'SALARYBOX', headerRow: 0 });
  const { rows, repaired } = extractRows(table, found.source, found.headerRow);
  assert.equal(rows.length, 2);
  assert.equal(repaired, 1);
  assert.equal(rows[0].laptop, 'LAPTOP-AB12CD3');
  assert.equal(rows[0].simDetails, '9000000771 / 8991000000000000169U');
  assert.equal(rows[0].other, 'Card •••• 9137');
  // Unmapped sensitive columns never make it into a record.
  assert.ok(!JSON.stringify(rows).includes('ABCDE1234F'));
  assert.ok(!JSON.stringify(rows).includes('123412341234'));
});

test('reconcile: identifiers and employee codes are normalised', async () => {
  const { employeeCodeKey, extractIdentifiers, normalizeIccid } = await import('./reconcile');
  assert.equal(employeeCodeKey('CT0000122'), employeeCodeKey('CT000122'));
  assert.equal(normalizeIccid('8991000000000000110U'), normalizeIccid('8991000000000000110'));
  const ids = extractIdentifiers('Dell - Device ID - A1B2C3D4-1111-4222-8333-444455556666 / Sim No. - 8991000000000000169U / Ph. No. - 9000000771 / 8XY1234');
  assert.deepEqual(ids.guids, ['A1B2C3D4-1111-4222-8333-444455556666']);
  assert.deepEqual(ids.iccids, ['8991000000000000169']);
  assert.deepEqual(ids.phones, ['9000000771']);
  assert.deepEqual(ids.serials, ['8XY1234']);
});
