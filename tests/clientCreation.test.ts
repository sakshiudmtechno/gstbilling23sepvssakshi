import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ClientSchema } from '../src/server/validation.ts';

describe('Client Creation Schema Tests', () => {
  test('Validates complete client data correctly', () => {
    const payload = {
      name: 'Radical Fabrotech Pvt Ltd',
      contactPerson: 'Rajesh Sharma',
      email: 'rajesh@radicalfab.com',
      phone: '+91 98220 12345',
      billingAddress: 'Plot 42, Sanwer Road Industrial Area',
      shippingAddress: 'Plot 42, Sanwer Road Industrial Area',
      city: 'Indore',
      state: 'Madhya Pradesh',
      stateCode: '23',
      country: 'India',
      pinCode: '452015',
      gstin: '23AHWPH3168H2Z2',
      pan: 'AHWPH3168H',
      customerType: 'B2B',
      notes: 'Key client'
    };

    const result = ClientSchema.safeParse(payload);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Radical Fabrotech Pvt Ltd');
      assert.equal(result.data.stateCode, '23');
    }
  });

  test('Handles email with trailing whitespace and cleans it', () => {
    const payload = {
      name: 'Whitespace Client',
      email: '  test.client@example.com  ',
      state: 'Maharashtra',
      stateCode: '27'
    };

    const result = ClientSchema.safeParse(payload);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.email, 'test.client@example.com');
    }
  });

  test('Gracefully handles null optional fields without throwing 400 error', () => {
    const payload = {
      name: 'Null Fields Client',
      contactPerson: null,
      email: null,
      phone: null,
      billingAddress: null,
      city: null,
      pinCode: null,
      gstin: null,
      pan: null,
      notes: null
    };

    const result = ClientSchema.safeParse(payload);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.name, 'Null Fields Client');
      assert.equal(result.data.email, '');
      assert.equal(result.data.phone, '');
      assert.equal(result.data.state, 'Madhya Pradesh');
      assert.equal(result.data.stateCode, '23');
    }
  });

  test('Accepts numeric stateCode and normalizes it to 2-digit string', () => {
    const payload = {
      name: 'Numeric State Code Client',
      state: 'Karnataka',
      stateCode: 29
    };

    const result = ClientSchema.safeParse(payload);
    assert.equal(result.success, true);
    if (result.success) {
      assert.equal(result.data.stateCode, '29');
      assert.equal(result.data.state, 'Karnataka');
    }
  });

  test('Rejects client with empty or whitespace-only name', () => {
    const payload = {
      name: '   ',
      state: 'Madhya Pradesh',
      stateCode: '23'
    };

    const result = ClientSchema.safeParse(payload);
    assert.equal(result.success, false);
  });
});
