'use client';

import { useEffect, useMemo } from 'react';
import { BarChart3, Search, TrendingDown, TrendingUp } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isFinite as isFiniteNumber } from 'lodash';

import { fetchMarketSectorStrength } from '@/app/api/fund';
import { fetchStockQuotes } from '@/app/api/stock';
import { useModalStore, useStorageStore } from '@/app/stores';
import MarketSectorStrength from './MarketSectorStrength';

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!isFiniteNumber(number)) return '—';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatPercent = (value) => {
  const number = Number(value);
  if (!isFiniteNumber(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
};

export default function StockMarketTab({ isActive = false }) {
  const stocks = useStorageStore((state) => state.stocks);
  const initStocks = useStorageStore((state) => state.initStocks);

  useEffect(() => {
    initStocks();
  }, [initStocks]);

  const stockCodes = useMemo(
    () => (isArray(stocks) ? stocks.map((stock) => stock?.code).filter(Boolean) : []),
    [stocks]
  );

  const { data: sectorEstimates, isLoading: sectorsLoading } = useQuery({
    queryKey: ['stockMarketSectors'],
    queryFn: fetchMarketSectorStrength,
    enabled: Boolean(isActive),
    staleTime: 120000,
    refetchInterval: isActive ? 120000 : false
  });

  const { data: freshQuotes, isLoading: quotesLoading } = useQuery({
    queryKey: ['stockMarketWatchlist', stockCodes.join(',')],
    queryFn: () => fetchStockQuotes(stockCodes),
    enabled: Boolean(isActive && stockCodes.length > 0),
    staleTime: 30000,
    refetchInterval: isActive && stockCodes.length > 0 ? 30000 : false
  });

  const watchlist = useMemo(() => {
    const storedStocks = isArray(stocks) ? stocks : [];
    const quoteMap = new Map((isArray(freshQuotes) ? freshQuotes : []).map((quote) => [quote.code, quote]));
    return storedStocks
      .map((stock) => ({ ...stock, ...(quoteMap.get(stock.code) || {}) }))
      .sort((a, b) => Number(b.changePercent || 0) - Number(a.changePercent || 0))
      .slice(0, 8);
  }, [freshQuotes, stocks]);

  return (
    <main className="asset-market-page stock-market-page" aria-label="股票行情">
      <section className="asset-market-intro glass">
        <div>
          <span className="asset-market-eyebrow">
            <BarChart3 size={15} /> 股票行情
          </span>
          <h1>市场板块与自选快照</h1>
          <p>板块资金强弱归入股票行情；可在顶部输入 A 股、港股或美股代码添加到看板。</p>
        </div>
        <div className="asset-market-intro__hint">
          <Search size={16} /> 顶部搜索支持 600036 / 00700 / AAPL
        </div>
      </section>

      <MarketSectorStrength
        sectors={sectorEstimates}
        isLoading={sectorsLoading}
        onViewAll={() =>
          useModalStore.setState({
            allSectorsModalOpen: true,
            allSectorsFilter: 'industry',
            allSectorsSort: 'change_pct',
            allSectorsSortOrder: 'desc'
          })
        }
      />

      <section className="stock-market-watchlist glass" aria-labelledby="stock-market-watchlist-title">
        <div className="stock-market-watchlist__header">
          <div>
            <span>实时/延迟行情</span>
            <h2 id="stock-market-watchlist-title">我的股票快照</h2>
          </div>
          <small>{quotesLoading ? '刷新中…' : `${watchlist.length} 只`}</small>
        </div>

        {watchlist.length > 0 ? (
          <div className="stock-market-watchlist__grid">
            {watchlist.map((stock) => {
              const change = Number(stock.changePercent || 0);
              const isUp = change > 0;
              const isDown = change < 0;
              return (
                <article
                  key={stock.code}
                  className={`stock-market-quote ${isUp ? 'is-up' : ''} ${isDown ? 'is-down' : ''}`}
                >
                  <div>
                    <strong>{stock.name || stock.displayCode}</strong>
                    <span>
                      {stock.marketLabel} · {stock.displayCode}
                    </span>
                  </div>
                  <div className="stock-market-quote__price">
                    {isUp ? <TrendingUp size={17} /> : isDown ? <TrendingDown size={17} /> : null}
                    <strong>{formatNumber(stock.price, stock.market === 'hk' ? 3 : 2)}</strong>
                    <span>{formatPercent(change)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="asset-market-empty">
            <Search size={25} />
            <div>
              <strong>还没有股票自选</strong>
              <span>从顶部搜索框输入股票代码即可添加。</span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
