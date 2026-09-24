import test from 'node:test';
import assert from 'node:assert/strict';
import { OnboardingSchema, DealServiceItemSchema } from '../src/server/validation.ts';
import { DealServiceItem, CustomerOnboarding } from '../src/types.ts';

test('Multi-Service Deal: DealServiceItemSchema validates individual service breakdowns', () => {
  const service1 = {
    id: 'srv_1',
    serviceName: 'Social Media Management',
    managementFee: 15000,
    managementFeePaid: 15000,
    adBudget: 0,
    adBudgetPaid: 0,
    dealValue: 15000,
    totalReceived: 15000,
    totalDue: 0
  };

  const parsed1 = DealServiceItemSchema.safeParse(service1);
  assert.equal(parsed1.success, true);
  if (parsed1.success) {
    assert.equal(parsed1.data.serviceName, 'Social Media Management');
    assert.equal(parsed1.data.managementFee, 15000);
    assert.equal(parsed1.data.managementFeePaid, 15000);
    assert.equal(parsed1.data.totalDue, 0);
  }

  const service2 = {
    id: 'srv_2',
    serviceName: 'Google Ads',
    managementFee: 10000,
    managementFeePaid: 5000,
    adBudget: 20000,
    adBudgetPaid: 10000,
    dealValue: 30000,
    totalReceived: 15000,
    totalDue: 15000
  };

  const parsed2 = DealServiceItemSchema.safeParse(service2);
  assert.equal(parsed2.success, true);
  if (parsed2.success) {
    assert.equal(parsed2.data.serviceName, 'Google Ads');
    assert.equal(parsed2.data.managementFee, 10000);
    assert.equal(parsed2.data.adBudget, 20000);
    assert.equal(parsed2.data.dealValue, 30000);
    assert.equal(parsed2.data.totalReceived, 15000);
    assert.equal(parsed2.data.totalDue, 15000);
  }
});

test('Multi-Service Deal: OnboardingSchema validates multi-service deal record with nested services', () => {
  const services: DealServiceItem[] = [
    {
      id: 'srv_1',
      serviceName: 'Social Media Management',
      managementFee: 15000,
      managementFeePaid: 10000,
      adBudget: 0,
      adBudgetPaid: 0,
      dealValue: 15000,
      totalReceived: 10000,
      totalDue: 5000
    },
    {
      id: 'srv_2',
      serviceName: 'Google Ads',
      managementFee: 10000,
      managementFeePaid: 10000,
      adBudget: 15000,
      adBudgetPaid: 10000,
      dealValue: 25000,
      totalReceived: 20000,
      totalDue: 5000
    }
  ];

  const totalMgmt = services.reduce((s, it) => s + it.managementFee, 0); // 25,000
  const totalMgmtPaid = services.reduce((s, it) => s + it.managementFeePaid, 0); // 20,000
  const totalAd = services.reduce((s, it) => s + it.adBudget, 0); // 15,000
  const totalAdPaid = services.reduce((s, it) => s + it.adBudgetPaid, 0); // 10,000
  const totalDealValue = totalMgmt + totalAd; // 40,000
  const totalReceived = totalMgmtPaid + totalAdPaid; // 30,000
  const totalDue = totalDealValue - totalReceived; // 10,000

  const dealPayload = {
    customerName: 'Acme Global Ventures',
    businessName: 'Acme Global Ventures',
    phone: '+91 9876543210',
    onboardingDate: '2026-09-24',
    servicePackage: services.map(s => s.serviceName).join(', '),
    services,
    serviceFee: totalMgmt,
    managementFee: totalMgmt,
    managementFeePaid: totalMgmtPaid,
    adBudget: totalAd,
    adTotalBudget: totalAd,
    adBudgetPaid: totalAdPaid,
    hasAdsCampaign: totalAd > 0,
    totalPackageValue: totalDealValue,
    totalDealValue,
    advancePaid: totalReceived,
    totalReceived,
    remainingBalance: totalDue,
    totalDue,
    paymentStatus: 'partially_paid' as const,
    salesManager: 'Mahendra',
    remarks: 'Multi-service deal onboarding'
  };

  const parseResult = OnboardingSchema.safeParse(dealPayload);
  assert.equal(parseResult.success, true);
  if (parseResult.success) {
    assert.equal(parseResult.data.services?.length, 2);
    assert.equal(parseResult.data.services?.[0].serviceName, 'Social Media Management');
    assert.equal(parseResult.data.services?.[1].serviceName, 'Google Ads');
    assert.equal(parseResult.data.totalDealValue, 40000);
    assert.equal(parseResult.data.totalReceived, 30000);
    assert.equal(parseResult.data.totalDue, 10000);
    assert.equal(parseResult.data.servicePackage, 'Social Media Management, Google Ads');
  }
});

test('Multi-Service Deal: Adding, removing, and updating services dynamically computes accurate totals', () => {
  // Start with 1 service
  let services: DealServiceItem[] = [
    {
      id: 'srv_1',
      serviceName: 'Social Media Management',
      managementFee: 15000,
      managementFeePaid: 15000,
      adBudget: 0,
      adBudgetPaid: 0,
      dealValue: 15000,
      totalReceived: 15000,
      totalDue: 0
    }
  ];

  let dealValue = services.reduce((s, it) => s + it.managementFee + it.adBudget, 0);
  let dealReceived = services.reduce((s, it) => s + it.managementFeePaid + it.adBudgetPaid, 0);
  assert.equal(dealValue, 15000);
  assert.equal(dealReceived, 15000);
  assert.equal(dealValue - dealReceived, 0);

  // Add 2nd service: Google Ads (₹10,000 fee, ₹10,000 ad budget, ₹5,000 paid)
  services.push({
    id: 'srv_2',
    serviceName: 'Google Ads',
    managementFee: 10000,
    managementFeePaid: 5000,
    adBudget: 10000,
    adBudgetPaid: 0,
    dealValue: 20000,
    totalReceived: 5000,
    totalDue: 15000
  });

  dealValue = services.reduce((s, it) => s + it.managementFee + it.adBudget, 0);
  dealReceived = services.reduce((s, it) => s + it.managementFeePaid + it.adBudgetPaid, 0);
  assert.equal(services.length, 2);
  assert.equal(dealValue, 35000); // 15000 + 20000
  assert.equal(dealReceived, 20000); // 15000 + 5000
  assert.equal(dealValue - dealReceived, 15000);

  // Add 3rd service: SEO & Website (₹25,000 fee, ₹10,000 paid)
  services.push({
    id: 'srv_3',
    serviceName: 'SEO & Website',
    managementFee: 25000,
    managementFeePaid: 10000,
    adBudget: 0,
    adBudgetPaid: 0,
    dealValue: 25000,
    totalReceived: 10000,
    totalDue: 15000
  });

  dealValue = services.reduce((s, it) => s + it.managementFee + it.adBudget, 0);
  dealReceived = services.reduce((s, it) => s + it.managementFeePaid + it.adBudgetPaid, 0);
  assert.equal(services.length, 3);
  assert.equal(dealValue, 60000); // 35000 + 25000
  assert.equal(dealReceived, 30000); // 20000 + 10000
  assert.equal(dealValue - dealReceived, 30000);

  // Remove 2nd service (Google Ads added by mistake)
  services = services.filter(s => s.id !== 'srv_2');
  dealValue = services.reduce((s, it) => s + it.managementFee + it.adBudget, 0);
  dealReceived = services.reduce((s, it) => s + it.managementFeePaid + it.adBudgetPaid, 0);
  assert.equal(services.length, 2);
  assert.equal(dealValue, 40000); // 15000 + 25000
  assert.equal(dealReceived, 25000); // 15000 + 10000
  assert.equal(dealValue - dealReceived, 15000);
});

test('Multi-Service Deal: Backward compatibility with legacy single-service deals', () => {
  const legacyDeal = {
    customerName: 'Apex Logistics',
    businessName: 'Apex Logistics',
    phone: '+91 9999988888',
    servicePackage: 'Meta Ads & Lead Gen Retainer',
    serviceFee: 15000,
    adTotalBudget: 10000,
    advancePaid: 15000
  };

  const parsed = OnboardingSchema.safeParse(legacyDeal);
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.customerName, 'Apex Logistics');
    assert.equal(parsed.data.servicePackage, 'Meta Ads & Lead Gen Retainer');
    assert.equal(parsed.data.serviceFee, 15000);
    assert.equal(parsed.data.adTotalBudget, 10000);
  }
});
