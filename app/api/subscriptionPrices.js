import { parseSubscriptionPriceCatalog } from '@/app/lib/subscriptionPriceCatalog';

export const SUBSCRIPTION_PRICE_GITHUB_URL =
  'https://github.com/ajin972517/xinban-asset-dashboard/blob/main/public/data/subscription-prices.md';

const RAW_GITHUB_URL =
  'https://raw.githubusercontent.com/ajin972517/xinban-asset-dashboard/main/public/data/subscription-prices.md';

export const fetchSubscriptionPriceCatalog = async () => {
  const sources = [
    { url: RAW_GITHUB_URL, source: 'github' },
    { url: '/data/subscription-prices.md', source: 'local' }
  ];
  let lastError = null;

  for (const candidate of sources) {
    try {
      const response = await fetch(candidate.url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`价格数据请求失败：${response.status}`);
      const markdown = await response.text();
      const items = parseSubscriptionPriceCatalog(markdown);
      if (items.length === 0) throw new Error('价格数据为空');
      return { items, source: candidate.source, fetchedAt: Date.now() };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('订阅价格数据暂时不可用');
};
