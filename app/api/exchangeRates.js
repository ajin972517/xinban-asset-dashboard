import { isObject } from 'lodash';

const EXCHANGE_RATE_ENDPOINT = 'https://api.frankfurter.dev/v1/latest?base=CNY&symbols=USD,HKD';

export const fetchSubscriptionExchangeRates = async () => {
  const response = await fetch(EXCHANGE_RATE_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) throw new Error(`汇率请求失败：${response.status}`);
  const payload = await response.json();
  if (!payload?.rates || !isObject(payload.rates)) throw new Error('汇率数据格式错误');

  const usdPerCny = Number(payload.rates.USD);
  const hkdPerCny = Number(payload.rates.HKD);
  if (!(usdPerCny > 0) || !(hkdPerCny > 0)) throw new Error('汇率数据不可用');

  return {
    base: 'CNY',
    rates: {
      CNY: 1,
      USD: 1 / usdPerCny,
      HKD: 1 / hkdPerCny
    },
    date: payload.date || '',
    fetchedAt: Date.now(),
    source: 'Frankfurter'
  };
};
