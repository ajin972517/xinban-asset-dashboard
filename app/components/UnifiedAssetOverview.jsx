'use client';

import { useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { isArray, isNil, isObject } from 'lodash';
import { BarChart3, Boxes, CircleDollarSign, Landmark } from 'lucide-react';

import { fetchGoldQuote } from '@/app/api/fund';
import { useStorageStore } from '@/app/stores';

const CURRENCY_RATES = { CNY: 1, HKD: 0.92, USD: 7.2 };

const formatNumber = (value) =>
  Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCurrency = (value, masked = false) => {
  if (masked) return '¥••••••';
  if (isNil(value) || !Number.isFinite(Number(value))) return '—';
  return `¥${formatNumber(Number(value))}`;
};

const formatSignedCurrency = (value, masked = false) => {
  if (masked) return '¥••••••';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const sign = number > 0 ? '+' : number < 0 ? '-' : '';
  return `${sign}¥${formatNumber(Math.abs(number))}`;
};

const getChangeClass = (value) => {
  const number = Number(value);
  if (number > 0) return 'stock-value-up';
  if (number < 0) return 'stock-value-down';
  return '';
};

const getPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const getBestSellPrice = (quotes, platform) => {
  const quoteList = (isArray(quotes) ? quotes : []).filter((quote) => quote && isObject(quote));
  const platformQuotes =
    platform && platform !== 'auto' ? quoteList.filter((quote) => quote.platform === platform) : quoteList;
  const prices = platformQuotes.map((quote) => getPositiveNumber(quote.sellPrice)).filter((price) => price != null);
  return prices.length > 0 ? Math.min(...prices) : null;
};

export default function UnifiedAssetOverview({ fundSummary = null, masked = false, className = '' }) {
  const {
    stocks,
    stockDividends,
    bankGoldHolding,
    bankGoldQuote,
    cs2Settings,
    cs2Inventory,
    cs2Prices,
    initStocks,
    initStockDividends,
    initBankGoldHolding,
    initBankGoldQuote,
    initCs2Settings,
    initCs2Inventory,
    initCs2Prices
  } = useStorageStore();

  useEffect(() => {
    initStocks();
    initStockDividends();
    initBankGoldHolding();
    initBankGoldQuote();
    initCs2Settings();
    initCs2Inventory();
    initCs2Prices();
  }, [
    initBankGoldHolding,
    initBankGoldQuote,
    initCs2Inventory,
    initCs2Prices,
    initCs2Settings,
    initStockDividends,
    initStocks
  ]);

  const { data: freshGoldQuote } = useQuery({
    queryKey: ['bankGoldAu9999Quote'],
    queryFn: fetchGoldQuote,
    staleTime: 60000,
    refetchInterval: 60000
  });

  const summary = useMemo(() => {
    const fundAsset = Number(fundSummary?.totalAsset) || 0;
    const fundProfit = Number(fundSummary?.totalHoldingReturn) || 0;
    const dividendMap = stockDividends && isObject(stockDividends) && !isArray(stockDividends) ? stockDividends : {};

    const stockSummary = (isArray(stocks) ? stocks : []).reduce(
      (result, stock) => {
        const shares = Math.max(0, Number(stock?.shares) || 0);
        const price = Math.max(0, Number(stock?.price) || 0);
        const costPrice = Math.max(0, Number(stock?.costPrice) || 0);
        const rate = CURRENCY_RATES[stock?.currency] || 1;
        const dividends = (isArray(dividendMap?.[stock?.code]) ? dividendMap[stock.code] : []).reduce(
          (sum, entry) => sum + (Number(entry?.amount) || 0),
          0
        );
        result.asset += shares * price * rate;
        result.profit += ((shares > 0 && costPrice > 0 ? shares * (price - costPrice) : 0) + dividends) * rate;
        return result;
      },
      { asset: 0, profit: 0 }
    );

    const goldGrams = Math.max(0, Number(bankGoldHolding?.grams) || 0);
    const manualGoldPrice =
      Number(bankGoldHolding?.manualSellPrice) > 0 ? Number(bankGoldHolding.manualSellPrice) : null;
    const referenceGoldPrice =
      Number(freshGoldQuote?.price) > 0
        ? Number(freshGoldQuote.price)
        : Number(bankGoldQuote?.price) > 0
          ? Number(bankGoldQuote.price)
          : null;
    const goldPrice = manualGoldPrice || referenceGoldPrice;
    const goldAsset = goldPrice ? goldGrams * goldPrice : 0;
    const goldCost = Math.max(0, Number(bankGoldHolding?.totalCost) || 0);
    const goldProfit = goldAsset > 0 && goldCost > 0 ? goldAsset - goldCost : 0;

    const priceMap = new Map(
      (isArray(cs2Prices?.data) ? cs2Prices.data : [])
        .filter((entry) => entry?.marketHashName)
        .map((entry) => [String(entry.marketHashName), isArray(entry.dataList) ? entry.dataList : []])
    );
    const cs2Summary = (isArray(cs2Inventory?.items) ? cs2Inventory.items : []).reduce(
      (result, item) => {
        const amount = Math.max(1, Number(item?.amount) || 1);
        const sellPrice = getBestSellPrice(
          priceMap.get(String(item?.marketHashName || '')),
          cs2Settings?.pricePlatform
        );
        result.totalCount += amount;
        if (sellPrice != null) {
          result.asset += sellPrice * amount;
          result.pricedCount += amount;
        }
        return result;
      },
      { asset: 0, pricedCount: 0, totalCount: 0 }
    );

    return {
      fundAsset,
      fundProfit,
      stockAsset: stockSummary.asset,
      stockProfit: stockSummary.profit,
      goldAsset,
      goldProfit,
      goldPriceSource: manualGoldPrice ? '银行卖出价' : 'Au99.99 参考价',
      cs2Asset: cs2Summary.asset,
      cs2PricedCount: cs2Summary.pricedCount,
      cs2TotalCount: cs2Summary.totalCount,
      total: fundAsset + stockSummary.asset + goldAsset + cs2Summary.asset
    };
  }, [
    bankGoldHolding,
    bankGoldQuote,
    cs2Inventory,
    cs2Prices,
    cs2Settings,
    freshGoldQuote,
    fundSummary,
    stockDividends,
    stocks
  ]);

  return (
    <section className={`stock-unified-summary glass ${className}`.trim()} aria-label="统一资产概览">
      <div className="stock-unified-summary__main">
        <span>统一资产概览（人民币参考）</span>
        <strong>{formatCurrency(summary.total, masked)}</strong>
        <small>海外资产按参考汇率折算：1 USD ≈ ¥7.20，1 HKD ≈ ¥0.92</small>
      </div>
      <div className="stock-unified-summary__split">
        <div>
          <Landmark size={16} aria-hidden="true" />
          <span>基金资产</span>
          <strong>{formatCurrency(summary.fundAsset, masked)}</strong>
          <small className={getChangeClass(summary.fundProfit)}>
            持有 {formatSignedCurrency(summary.fundProfit, masked)}
          </small>
        </div>
        <div>
          <BarChart3 size={16} aria-hidden="true" />
          <span>股票资产</span>
          <strong>{formatCurrency(summary.stockAsset, masked)}</strong>
          <small className={getChangeClass(summary.stockProfit)}>
            累计 {formatSignedCurrency(summary.stockProfit, masked)}
          </small>
        </div>
        <div>
          <CircleDollarSign size={16} aria-hidden="true" />
          <span>银行黄金</span>
          <strong>{formatCurrency(summary.goldAsset, masked)}</strong>
          <small className={getChangeClass(summary.goldProfit)}>
            {summary.goldAsset > 0
              ? `累计 ${formatSignedCurrency(summary.goldProfit, masked)} · ${summary.goldPriceSource}`
              : '尚未录入持仓'}
          </small>
        </div>
        <div>
          <Boxes size={16} aria-hidden="true" />
          <span>CS2饰品库存</span>
          <strong>{formatCurrency(summary.cs2Asset, masked)}</strong>
          <small>
            当前库存估值 · 已覆盖 {summary.cs2PricedCount}/{summary.cs2TotalCount} 件
          </small>
        </div>
      </div>
    </section>
  );
}
