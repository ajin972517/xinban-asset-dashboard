'use client';

import { useEffect, useMemo } from 'react';
import {
  ArrowUpRight,
  BarChart3,
  Boxes,
  ChevronRight,
  Clock3,
  ExternalLink,
  Gem,
  Layers3,
  Newspaper,
  RefreshCw,
  ShieldCheck,
  WalletCards
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isFinite as isFiniteNumber, isObject } from 'lodash';

import { fetchCs2MarketOverview, fetchCs2OfficialNews } from '@/app/api/cs2';
import { useStorageStore } from '@/app/stores';

const PLATFORM_NAMES = {
  steam: 'Steam',
  buff: 'BUFF',
  youpin: '悠悠有品',
  c5: 'C5GAME',
  c5game: 'C5GAME'
};

const PRICE_CHANGE_TARGET_MS = 24 * 60 * 60 * 1000;
const PRICE_CHANGE_MIN_AGE_MS = 12 * 60 * 60 * 1000;
const PRICE_CHANGE_MAX_AGE_MS = 48 * 60 * 60 * 1000;

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!isFiniteNumber(number)) return '—';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatCurrency = (value) => {
  const number = Number(value);
  if (!isFiniteNumber(number)) return '—';
  return `¥${number.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatUpdateTime = (value) => {
  const timestamp = Number(value);
  if (!isFiniteNumber(timestamp) || timestamp <= 0) return '';
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toLocaleString('zh-CN', { hour12: false });
};

const formatNewsDate = (value) => {
  const timestamp = Number(value);
  if (!isFiniteNumber(timestamp) || timestamp <= 0) return '时间待确认';
  const milliseconds = timestamp < 1_000_000_000_000 ? timestamp * 1000 : timestamp;
  return new Date(milliseconds).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
};

const formatPriceChange = (value) => {
  const number = Number(value);
  if (!isFiniteNumber(number)) return '24h —';
  return `24h ${number > 0 ? '+' : ''}${formatNumber(number, 2)}%`;
};

const getHistoryPoints = (history, fallbackValue) => {
  const points = [];
  const walk = (entry) => {
    if (isArray(entry)) {
      const numbers = entry.map((value) => Number(value)).filter((value) => isFiniteNumber(value));
      if (numbers.length >= 2) {
        points.push(numbers.at(-1));
        return;
      }
      entry.forEach(walk);
      return;
    }
    if (!isObject(entry)) return;
    const candidate = [entry.broadMarketIndex, entry.marketIndex, entry.index, entry.value, entry.close]
      .map((value) => Number(value))
      .find((value) => isFiniteNumber(value));
    if (isFiniteNumber(candidate)) points.push(candidate);
  };
  walk(history);
  if (points.length === 0 && isFiniteNumber(Number(fallbackValue))) points.push(Number(fallbackValue));
  return points.slice(-30);
};

const getPriceChange = ({ history, marketHashName, platform, currentPrice, fetchedAt }) => {
  const current = Number(currentPrice);
  const currentTimestamp = Number(fetchedAt);
  if (
    !isFiniteNumber(current) ||
    current <= 0 ||
    !isFiniteNumber(currentTimestamp) ||
    currentTimestamp <= 0 ||
    !marketHashName ||
    !platform
  ) {
    return null;
  }

  const candidates = (isArray(history) ? history : [])
    .map((snapshot) => ({ snapshot, age: currentTimestamp - Number(snapshot?.fetchedAt) }))
    .filter(
      ({ snapshot, age }) =>
        isArray(snapshot?.items) && age >= PRICE_CHANGE_MIN_AGE_MS && age <= PRICE_CHANGE_MAX_AGE_MS
    )
    .sort((a, b) => Math.abs(a.age - PRICE_CHANGE_TARGET_MS) - Math.abs(b.age - PRICE_CHANGE_TARGET_MS));

  const normalizedPlatform = String(platform).toLowerCase();
  for (const { snapshot } of candidates) {
    const item = snapshot.items.find((entry) => String(entry?.marketHashName || '') === String(marketHashName));
    const quote = (isArray(item?.quotes) ? item.quotes : []).find(
      (entry) => String(entry?.platform || '').toLowerCase() === normalizedPlatform
    );
    const previousPrice = Number(quote?.price);
    if (!isFiniteNumber(previousPrice) || previousPrice <= 0) continue;
    const amount = current - previousPrice;
    return {
      amount,
      ratio: (amount / previousPrice) * 100,
      baselineAt: Number(snapshot.fetchedAt)
    };
  }

  return null;
};

function MarketSparkline({ values }) {
  const width = 420;
  const height = 116;
  const padding = 8;
  const safeValues = isArray(values) && values.length > 0 ? values : [0];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const span = max - min || 1;
  const points = safeValues
    .map((value, index) => {
      const x = padding + (index / Math.max(safeValues.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((value - min) / span) * (height - padding * 2);
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <svg className="cs2-market-sparkline" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="CS2 大盘指数走势">
      <defs>
        <linearGradient id="cs2MarketArea" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.34" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline
        points={`${padding},${height - padding} ${points} ${width - padding},${height - padding}`}
        fill="url(#cs2MarketArea)"
        stroke="none"
      />
      <polyline
        points={points}
        fill="none"
        stroke="var(--primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Cs2MarketTab({ isActive = false }) {
  const cs2Inventory = useStorageStore((state) => state.cs2Inventory);
  const cs2Prices = useStorageStore((state) => state.cs2Prices);
  const initCs2Inventory = useStorageStore((state) => state.initCs2Inventory);
  const initCs2Prices = useStorageStore((state) => state.initCs2Prices);

  useEffect(() => {
    initCs2Inventory();
    initCs2Prices();
  }, [initCs2Inventory, initCs2Prices]);

  const {
    data: marketData,
    isLoading,
    isFetching,
    error,
    refetch
  } = useQuery({
    queryKey: ['cs2MarketOverview'],
    queryFn: fetchCs2MarketOverview,
    enabled: Boolean(isActive),
    staleTime: 300000,
    refetchInterval: isActive ? 300000 : false
  });

  const {
    data: newsData,
    isLoading: isNewsLoading,
    isFetching: isNewsFetching,
    error: newsError,
    refetch: refetchNews
  } = useQuery({
    queryKey: ['cs2OfficialNews'],
    queryFn: fetchCs2OfficialNews,
    enabled: Boolean(isActive),
    staleTime: 30 * 60_000,
    refetchInterval: isActive ? 30 * 60_000 : false
  });

  const inventorySummary = useMemo(() => {
    const items = isArray(cs2Inventory?.items) ? cs2Inventory.items : [];
    const priceRows = isArray(cs2Prices?.data) ? cs2Prices.data : [];
    const priceMap = new Map(priceRows.map((entry) => [String(entry?.marketHashName || ''), entry]));
    const rows = items.map((item) => {
      const quoteEntry = priceMap.get(String(item?.marketHashName || ''));
      const quotes = isArray(quoteEntry?.dataList) ? quoteEntry.dataList : [];
      const sellQuotes = quotes
        .map((quote) => ({ ...quote, price: Number(quote?.sellPrice) }))
        .filter((quote) => isFiniteNumber(quote.price) && quote.price > 0)
        .sort((a, b) => a.price - b.price);
      const best = sellQuotes[0] || null;
      const amount = Math.max(1, Number(item?.amount) || 1);
      const priceChange = best
        ? getPriceChange({
            history: cs2Prices?.history,
            marketHashName: item?.marketHashName,
            platform: best.platform,
            currentPrice: best.price,
            fetchedAt: cs2Prices?.fetchedAt
          })
        : null;
      return {
        name: item?.name || item?.marketHashName || '未知饰品',
        marketHashName: item?.marketHashName || '',
        amount,
        price: best?.price ?? null,
        platform: best?.platform || '',
        value: best ? best.price * amount : null,
        priceChange
      };
    });
    return {
      itemCount: rows.reduce((sum, item) => sum + item.amount, 0),
      pricedCount: rows.filter((item) => item.value !== null).reduce((sum, item) => sum + item.amount, 0),
      totalValue: rows.reduce((sum, item) => sum + (item.value || 0), 0),
      topItems: rows
        .filter((item) => item.value !== null)
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
    };
  }, [cs2Inventory, cs2Prices]);

  const marketIndex = Number(marketData?.broadMarketIndex);
  const diffValue = Number(marketData?.diffYesterday);
  const diffRatio = Number(marketData?.diffYesterdayRatio);
  const historyPoints = getHistoryPoints(marketData?.historyMarketIndexList, marketIndex);
  const trendClass = diffRatio > 0 ? 'is-up' : diffRatio < 0 ? 'is-down' : '';
  const updateTime = formatUpdateTime(marketData?.updateTime);
  const newsItems = isArray(newsData?.items) ? newsData.items.slice(0, 3) : [];
  const refreshing = isFetching || isNewsFetching;

  return (
    <main className="asset-market-page cs2-market-page" aria-label="CS2 行情">
      <section className="cs2-market-hero glass">
        <div className="cs2-market-hero__content">
          <span className="asset-market-eyebrow">
            <Gem size={15} /> SteamDT 官方开放数据
          </span>
          <h1>CS2 饰品市场总览</h1>
          <p>行情页不设置搜索框，集中展示大盘指数、走势和你的库存市场快照。</p>
          <div className="cs2-market-links">
            <a href="https://www.steamdt.com/" target="_blank" rel="noreferrer">
              SteamDT 市场总览 <ExternalLink size={14} />
            </a>
            <a href="https://www.steamdt.com/mkt" target="_blank" rel="noreferrer">
              多平台饰品市场 <ExternalLink size={14} />
            </a>
            <a href="https://www.steamdt.com/section" target="_blank" rel="noreferrer">
              板块指数 <ExternalLink size={14} />
            </a>
          </div>
        </div>
        <button
          type="button"
          className="cs2-market-refresh"
          onClick={() => {
            refetch();
            refetchNews();
          }}
          disabled={refreshing}
        >
          <RefreshCw size={16} className={refreshing ? 'stock-header-search__spin' : ''} />
          {refreshing ? '刷新中' : '刷新行情'}
        </button>
      </section>

      <section className="cs2-market-overview-grid">
        <article className={`cs2-market-index-card glass ${trendClass}`}>
          <div className="cs2-market-index-card__copy">
            <span>SteamDT 大盘指数</span>
            <strong>{isLoading ? '加载中…' : formatNumber(marketIndex, 2)}</strong>
            <div>
              <b>{isFiniteNumber(diffValue) ? `${diffValue > 0 ? '+' : ''}${formatNumber(diffValue, 2)}` : '—'}</b>
              <b>{isFiniteNumber(diffRatio) ? `${diffRatio > 0 ? '+' : ''}${formatNumber(diffRatio, 2)}%` : '—'}</b>
            </div>
            <small>{updateTime ? `更新于 ${updateTime}` : error?.message || '等待 SteamDT 行情数据'}</small>
          </div>
          <MarketSparkline values={historyPoints} />
        </article>

        <div className="cs2-market-metric-grid">
          <article className="cs2-market-metric glass">
            <WalletCards size={20} />
            <span>我的库存估值</span>
            <strong>{formatCurrency(inventorySummary.totalValue)}</strong>
            <small>按各平台最低在售价估算</small>
          </article>
          <article className="cs2-market-metric glass">
            <Boxes size={20} />
            <span>库存饰品</span>
            <strong>{inventorySummary.itemCount.toLocaleString('zh-CN')} 件</strong>
            <small>已覆盖 {inventorySummary.pricedCount} 件报价</small>
          </article>
          <article className="cs2-market-metric glass">
            <Layers3 size={20} />
            <span>行情来源</span>
            <strong>4 平台</strong>
            <small>Steam / BUFF / 悠悠 / C5GAME</small>
          </article>
        </div>
      </section>

      <section className="cs2-market-news glass" aria-labelledby="cs2-market-news-title">
        <div className="cs2-market-news__header">
          <div>
            <span>
              <ShieldCheck size={14} /> Steam 官方
            </span>
            <h2 id="cs2-market-news-title">CS2 更新日志</h2>
          </div>
          <a href="https://steamcommunity.com/app/730/announcements" target="_blank" rel="noreferrer">
            全部公告 <ExternalLink size={14} />
          </a>
        </div>

        {newsItems.length > 0 ? (
          <div className="cs2-market-news__list">
            {newsItems.map((item) => (
              <a key={item.id || item.url} href={item.url} target="_blank" rel="noreferrer">
                <Newspaper size={18} />
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    <Clock3 size={12} /> {formatNewsDate(item.publishedAt)}
                  </span>
                  {item.summary ? <p>{item.summary}</p> : null}
                </div>
                <ChevronRight size={18} />
              </a>
            ))}
          </div>
        ) : (
          <div className="cs2-market-news__empty">
            <Newspaper size={22} />
            <div>
              <strong>{isNewsLoading ? '正在获取 Steam 官方更新…' : '官方公告暂时不可用'}</strong>
              <span>{newsError?.message || '稍后重试，不影响其他 CS2 行情数据。'}</span>
            </div>
            {!isNewsLoading ? (
              <button type="button" onClick={() => refetchNews()} disabled={isNewsFetching}>
                重试
              </button>
            ) : null}
          </div>
        )}
      </section>

      <section className="cs2-market-ranking glass" aria-labelledby="cs2-market-ranking-title">
        <div className="cs2-market-ranking__header">
          <div>
            <span>我的库存</span>
            <h2 id="cs2-market-ranking-title">高市值饰品</h2>
          </div>
          <BarChart3 size={20} />
        </div>
        {inventorySummary.topItems.length > 0 ? (
          <div className="cs2-market-ranking__list">
            {inventorySummary.topItems.map((item, index) => (
              <article key={item.marketHashName || `${item.name}-${index}`}>
                <span className="cs2-market-ranking__rank">#{index + 1}</span>
                <div>
                  <strong>{item.name}</strong>
                  <small>
                    {item.amount} 件 ·{' '}
                    {PLATFORM_NAMES[String(item.platform || '').toLowerCase()] || item.platform || '最低在售价'}
                  </small>
                </div>
                <div className="cs2-market-ranking__value">
                  <strong>{formatCurrency(item.value)}</strong>
                  <span>单价 {formatCurrency(item.price)}</span>
                  <span
                    className={`cs2-market-ranking__change ${
                      item.priceChange?.ratio > 0 ? 'is-up' : item.priceChange?.ratio < 0 ? 'is-down' : ''
                    }`}
                    title={
                      item.priceChange
                        ? `较 ${formatUpdateTime(item.priceChange.baselineAt)} 单价${
                            item.priceChange.amount > 0 ? '上涨' : item.priceChange.amount < 0 ? '下跌' : '持平'
                          } ${formatCurrency(Math.abs(item.priceChange.amount))}`
                        : '需要至少一条约 24 小时前的同平台价格快照'
                    }
                  >
                    {formatPriceChange(item.priceChange?.ratio)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="asset-market-empty">
            <Gem size={25} />
            <div>
              <strong>暂无库存报价</strong>
              <span>先在 CS2 首页同步公开库存，即可在这里查看市场快照。</span>
            </div>
          </div>
        )}
        <a className="cs2-market-ranking__more" href="https://www.steamdt.com/mkt" target="_blank" rel="noreferrer">
          查看 SteamDT 完整饰品市场 <ArrowUpRight size={15} />
        </a>
      </section>
    </main>
  );
}
