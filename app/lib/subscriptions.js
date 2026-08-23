import { isArray, isFinite as isFiniteNumber, isObject, isString } from 'lodash';

export const SUBSCRIPTION_CATEGORIES = ['AI 工具', '影音娱乐', '云存储', '办公软件', '会员服务', '其他'];

export const SUBSCRIPTION_CURRENCIES = ['CNY', 'USD', 'HKD'];

export const SUBSCRIPTION_CYCLES = [
  { value: 'weekly', label: '每周', days: 7 },
  { value: 'monthly', label: '每月', days: 365 / 12 },
  { value: 'quarterly', label: '每季', days: 365 / 4 },
  { value: 'yearly', label: '每年', days: 365 },
  { value: 'custom', label: '自定义', days: null }
];

export const SUBSCRIPTION_STATUSES = [
  { value: 'active', label: '使用中' },
  { value: 'trial', label: '试用中' },
  { value: 'paused', label: '已暂停' },
  { value: 'cancelled', label: '已取消' }
];

const VALID_CURRENCIES = new Set(SUBSCRIPTION_CURRENCIES);
const VALID_CYCLES = new Set(SUBSCRIPTION_CYCLES.map((item) => item.value));
const VALID_STATUSES = new Set(SUBSCRIPTION_STATUSES.map((item) => item.value));

export const normalizeSubscription = (value) => {
  if (!value || !isObject(value) || isArray(value)) return null;
  const name = isString(value.name) ? value.name.trim() : '';
  const id = isString(value.id) ? value.id.trim() : '';
  if (!id || !name) return null;
  const price = Number(value.price);
  const customDays = Number(value.customDays);
  const exchangeRateOverride = Number(value.exchangeRateOverride);

  return {
    id,
    name,
    category: SUBSCRIPTION_CATEGORIES.includes(value.category) ? value.category : '其他',
    price: isFiniteNumber(price) && price >= 0 ? price : 0,
    currency: VALID_CURRENCIES.has(value.currency) ? value.currency : 'CNY',
    billingCycle: VALID_CYCLES.has(value.billingCycle) ? value.billingCycle : 'monthly',
    customDays: isFiniteNumber(customDays) && customDays > 0 ? customDays : null,
    nextRenewalDate: isString(value.nextRenewalDate) ? value.nextRenewalDate : '',
    autoRenew: value.autoRenew !== false,
    status: VALID_STATUSES.has(value.status) ? value.status : 'active',
    paymentMethod: isString(value.paymentMethod) ? value.paymentMethod.trim() : '',
    notes: isString(value.notes) ? value.notes.trim() : '',
    exchangeRateOverride:
      isFiniteNumber(exchangeRateOverride) && exchangeRateOverride > 0 ? exchangeRateOverride : null,
    createdAt: Number(value.createdAt) || Date.now(),
    updatedAt: Number(value.updatedAt) || Date.now()
  };
};

export const normalizeSubscriptions = (value) =>
  (isArray(value) ? value : []).map(normalizeSubscription).filter(Boolean);

export const normalizeSubscriptionExchangeRates = (value) => {
  const source = value && isObject(value) && !isArray(value) ? value : {};
  const sourceRates = source.rates && isObject(source.rates) && !isArray(source.rates) ? source.rates : {};
  const rates = { CNY: 1 };
  for (const currency of ['USD', 'HKD']) {
    const rate = Number(sourceRates[currency]);
    if (isFiniteNumber(rate) && rate > 0) rates[currency] = rate;
  }
  return {
    base: 'CNY',
    rates,
    date: isString(source.date) ? source.date : '',
    fetchedAt: Number(source.fetchedAt) || 0,
    source: isString(source.source) ? source.source : ''
  };
};

export const getSubscriptionCycleDays = (subscription) => {
  if (subscription?.billingCycle === 'custom') {
    const days = Number(subscription.customDays);
    return isFiniteNumber(days) && days > 0 ? days : null;
  }
  return SUBSCRIPTION_CYCLES.find((item) => item.value === subscription?.billingCycle)?.days || null;
};

export const calculateSubscriptionCost = (subscription, exchangeRates) => {
  const price = Number(subscription?.price);
  const currency = subscription?.currency || 'CNY';
  const override = Number(subscription?.exchangeRateOverride);
  const automaticRate = Number(exchangeRates?.rates?.[currency]);
  const rate = currency === 'CNY' ? 1 : override > 0 ? override : automaticRate;
  const cycleDays = getSubscriptionCycleDays(subscription);

  if (!isFiniteNumber(price) || price < 0 || !isFiniteNumber(rate) || rate <= 0 || !cycleDays) {
    return { rate: null, cycleCny: null, dailyCny: null, monthlyCny: null, yearlyCny: null };
  }

  const cycleCny = price * rate;
  const dailyCny = cycleCny / cycleDays;
  return {
    rate,
    cycleCny,
    dailyCny,
    monthlyCny: dailyCny * (365 / 12),
    yearlyCny: dailyCny * 365
  };
};

export const getDaysUntilRenewal = (dateString, now = new Date()) => {
  if (!dateString) return null;
  const target = new Date(`${dateString}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.ceil((target.getTime() - today.getTime()) / 86400000);
};
