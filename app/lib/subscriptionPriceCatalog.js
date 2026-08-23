import { isArray, isString } from 'lodash';

const TABLE_HEADER_LABELS = new Set(['平台名称', '---']);

const cleanCell = (value) => (isString(value) ? value.trim() : '');

const normalizePrice = (value) => {
  const text = cleanCell(value);
  return text && text !== '-' ? text : '—';
};

const parsePurchaseLink = (value) => {
  const text = cleanCell(value);
  const markdownLink = text.match(/^\[([^\]]+)]\((https?:\/\/[^)]+)\)$/i);
  if (markdownLink) return { purchaseLabel: markdownLink[1], purchaseUrl: markdownLink[2] };
  if (/^https?:\/\//i.test(text)) return { purchaseLabel: '官方购买', purchaseUrl: text };
  return { purchaseLabel: text && text !== '待填写' ? text : '', purchaseUrl: '' };
};

export const parseSubscriptionPriceCatalog = (markdown) => {
  if (!isString(markdown)) return [];
  let category = '';
  let sequence = 0;
  const items = [];

  markdown.split(/\r?\n/).forEach((line) => {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      category = heading[1].trim();
      return;
    }
    if (!category || category === '填写规则' || !line.trim().startsWith('|')) return;

    const cells = line.trim().split('|').slice(1, -1).map(cleanCell);
    if (cells.length < 8) return;

    const [platform, plan, monthly, quarterly, yearly, purchase, updatedAt, currency] = cells;
    if (!platform || !plan || TABLE_HEADER_LABELS.has(platform) || /^[-:]+$/.test(platform)) return;

    sequence += 1;
    items.push({
      id: `${category}-${platform}-${plan}-${sequence}`,
      category,
      platform,
      plan,
      monthly: normalizePrice(monthly),
      quarterly: normalizePrice(quarterly),
      yearly: normalizePrice(yearly),
      updatedAt: /^\d{4}-\d{2}-\d{2}$/.test(updatedAt) ? updatedAt : '',
      currency: currency || '—',
      ...parsePurchaseLink(purchase)
    });
  });

  return items;
};

export const getSubscriptionCatalogMeta = (items) => {
  const list = isArray(items) ? items : [];
  const categories = Array.from(new Set(list.map((item) => item.category).filter(Boolean)));
  const platforms = Array.from(new Set(list.map((item) => item.platform).filter(Boolean)));
  const currencies = Array.from(new Set(list.map((item) => item.currency).filter((value) => value && value !== '—')));
  const latestUpdatedAt = list
    .map((item) => item.updatedAt)
    .filter(Boolean)
    .sort()
    .at(-1);
  return { categories, platforms, currencies, latestUpdatedAt: latestUpdatedAt || '' };
};
