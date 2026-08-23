'use client';

import { useMemo, useState } from 'react';
import { CalendarDays, Database, ExternalLink, Github, Layers3, RefreshCw, Search, WalletCards } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { isArray } from 'lodash';

import { fetchSubscriptionPriceCatalog, SUBSCRIPTION_PRICE_GITHUB_URL } from '@/app/api/subscriptionPrices';
import { getSubscriptionCatalogMeta } from '@/app/lib/subscriptionPriceCatalog';

const ALL_FILTER = '全部';

const getSourceLabel = (source) => (source === 'github' ? 'GitHub 最新数据' : '随网站发布的副本');

function PriceCell({ label, value }) {
  return (
    <div className="subscription-price-cell">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function SubscriptionMarketTab({ isActive = false }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [activeCategory, setActiveCategory] = useState(ALL_FILTER);
  const [activeCurrency, setActiveCurrency] = useState(ALL_FILTER);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['subscriptionPriceCatalog'],
    queryFn: fetchSubscriptionPriceCatalog,
    enabled: Boolean(isActive),
    staleTime: 60 * 60 * 1000
  });

  const items = useMemo(() => (isArray(data?.items) ? data.items : []), [data]);
  const meta = useMemo(() => getSubscriptionCatalogMeta(items), [items]);
  const filteredItems = useMemo(() => {
    const keyword = searchTerm.trim().toLocaleLowerCase('zh-CN');
    return items.filter((item) => {
      const categoryMatches = activeCategory === ALL_FILTER || item.category === activeCategory;
      const currencyMatches = activeCurrency === ALL_FILTER || item.currency === activeCurrency;
      const keywordMatches =
        !keyword ||
        [item.platform, item.plan, item.category, item.currency].some((value) =>
          String(value || '')
            .toLocaleLowerCase('zh-CN')
            .includes(keyword)
        );
      return categoryMatches && currencyMatches && keywordMatches;
    });
  }, [activeCategory, activeCurrency, items, searchTerm]);

  return (
    <main className="asset-market-page subscription-market-page" aria-label="订阅会员价格行情">
      <section className="subscription-market-hero glass">
        <div className="subscription-market-hero__content">
          <span className="asset-market-eyebrow">
            <WalletCards size={15} /> 订阅行情
          </span>
          <h1>会员价格参考</h1>
          <p>集中查看常用视频、AI、网盘、音乐和软件会员价格，价格文本与官方购买入口保持原样。</p>
          <div className="subscription-market-source">
            <Database size={14} />
            <span>{data ? getSourceLabel(data.source) : '正在读取价格数据'}</span>
            {meta.latestUpdatedAt ? <small>最近更新 {meta.latestUpdatedAt}</small> : null}
          </div>
        </div>
        <div className="subscription-market-actions">
          <button type="button" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw size={16} className={isFetching ? 'subscription-market-spin' : ''} />
            {isFetching ? '同步中' : '同步数据'}
          </button>
          <a href={SUBSCRIPTION_PRICE_GITHUB_URL} target="_blank" rel="noreferrer">
            <Github size={16} /> GitHub 数据
          </a>
        </div>
      </section>

      <section className="subscription-market-metrics" aria-label="价格数据概览">
        <article className="subscription-market-metric glass">
          <Database size={18} />
          <div>
            <strong>{items.length}</strong>
            <span>价格记录</span>
          </div>
        </article>
        <article className="subscription-market-metric glass">
          <WalletCards size={18} />
          <div>
            <strong>{meta.platforms.length}</strong>
            <span>订阅平台</span>
          </div>
        </article>
        <article className="subscription-market-metric glass">
          <Layers3 size={18} />
          <div>
            <strong>{meta.categories.length}</strong>
            <span>数据分类</span>
          </div>
        </article>
        <article className="subscription-market-metric glass">
          <CalendarDays size={18} />
          <div>
            <strong>{meta.latestUpdatedAt || '—'}</strong>
            <span>最近更新时间</span>
          </div>
        </article>
      </section>

      <section className="subscription-market-catalog glass" aria-labelledby="subscription-price-title">
        <div className="subscription-market-toolbar">
          <div>
            <span>价格资料库</span>
            <h2 id="subscription-price-title">订阅会员价格</h2>
          </div>
          <label className="subscription-market-search">
            <Search size={16} />
            <input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="搜索平台、会员或分类"
              aria-label="搜索订阅价格"
            />
          </label>
          <select
            value={activeCurrency}
            onChange={(event) => setActiveCurrency(event.target.value)}
            aria-label="按币种筛选"
          >
            <option value={ALL_FILTER}>全部币种</option>
            {meta.currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </select>
        </div>

        <div className="subscription-market-categories" aria-label="按分类筛选">
          {[ALL_FILTER, ...meta.categories].map((category) => (
            <button
              type="button"
              key={category}
              className={category === activeCategory ? 'is-active' : ''}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="subscription-market-state">
            <RefreshCw size={20} className="subscription-market-spin" /> 正在载入价格数据…
          </div>
        ) : error ? (
          <div className="subscription-market-state is-error">
            <span>{error.message || '价格数据暂时无法读取'}</span>
            <button type="button" onClick={() => refetch()}>
              重新尝试
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="subscription-market-state">没有符合当前筛选条件的价格记录。</div>
        ) : (
          <>
            <div className="subscription-market-table" role="table" aria-label="订阅会员价格表">
              <div className="subscription-market-table__head" role="row">
                <span>平台 / 会员</span>
                <span>月付</span>
                <span>季付</span>
                <span>年付</span>
                <span>币种 / 更新</span>
                <span>购买</span>
              </div>
              {filteredItems.map((item) => (
                <article className="subscription-market-row" role="row" key={item.id}>
                  <div className="subscription-market-service">
                    <span>{item.category}</span>
                    <strong>{item.platform}</strong>
                    <small>{item.plan}</small>
                  </div>
                  <strong className="subscription-market-price">{item.monthly}</strong>
                  <strong className="subscription-market-price">{item.quarterly}</strong>
                  <strong className="subscription-market-price">{item.yearly}</strong>
                  <div className="subscription-market-update">
                    <strong>{item.currency}</strong>
                    <small>{item.updatedAt || '日期待补充'}</small>
                  </div>
                  <div className="subscription-market-link">
                    {item.purchaseUrl ? (
                      <a
                        href={item.purchaseUrl}
                        target="_blank"
                        rel="noreferrer"
                        title={item.purchaseLabel || '官方购买'}
                      >
                        <ExternalLink size={15} /> <span>{item.purchaseLabel || '官方购买'}</span>
                      </a>
                    ) : (
                      <span>待补充</span>
                    )}
                  </div>
                </article>
              ))}
            </div>

            <div className="subscription-market-mobile-list">
              {filteredItems.map((item) => (
                <article className="subscription-market-card" key={`mobile-${item.id}`}>
                  <header>
                    <div>
                      <span>{item.category}</span>
                      <h3>{item.platform}</h3>
                      <small>{item.plan}</small>
                    </div>
                    <em>{item.currency}</em>
                  </header>
                  <div className="subscription-market-card__prices">
                    <PriceCell label="月付" value={item.monthly} />
                    <PriceCell label="季付" value={item.quarterly} />
                    <PriceCell label="年付" value={item.yearly} />
                  </div>
                  <footer>
                    <span>更新 {item.updatedAt || '待补充'}</span>
                    {item.purchaseUrl ? (
                      <a href={item.purchaseUrl} target="_blank" rel="noreferrer">
                        {item.purchaseLabel || '官方购买'} <ExternalLink size={14} />
                      </a>
                    ) : (
                      <span>购买链接待补充</span>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          </>
        )}

        <p className="subscription-market-disclaimer">
          价格仅作记录与比较，可能因活动、地区、支付渠道和新老用户政策发生变化；购买前请以平台官方页面为准。
        </p>
      </section>
    </main>
  );
}
