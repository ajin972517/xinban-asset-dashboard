'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CircleDollarSign, ExternalLink, Landmark, Pencil, RefreshCw, Save, Scale, ShieldCheck, X } from 'lucide-react';

import { fetchGoldQuote } from '@/app/api/fund';
import { useStorageStore } from '@/app/stores';
import UnifiedAssetOverview from './UnifiedAssetOverview';

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatCurrency = (value, masked = false) => {
  if (masked) return '¥••••••';
  return Number.isFinite(Number(value)) ? `¥${formatNumber(value)}` : '—';
};

const formatPercent = (value, masked = false) => {
  if (masked) return '••••';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
};

const getValueClass = (value) => {
  const number = Number(value);
  if (number > 0) return 'stock-value-up';
  if (number < 0) return 'stock-value-down';
  return '';
};

const formatTime = (timestamp) => {
  const value = Number(timestamp);
  if (!Number.isFinite(value) || value <= 0) return '—';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
};

function useBankGoldQuote(isActive = true) {
  const bankGoldQuote = useStorageStore((state) => state.bankGoldQuote);
  const setBankGoldQuote = useStorageStore((state) => state.setBankGoldQuote);
  const initBankGoldQuote = useStorageStore((state) => state.initBankGoldQuote);
  const query = useQuery({
    queryKey: ['bankGoldAu9999Quote'],
    queryFn: fetchGoldQuote,
    enabled: Boolean(isActive),
    staleTime: 60000,
    refetchInterval: isActive ? 60000 : false
  });

  useEffect(() => {
    initBankGoldQuote();
  }, [initBankGoldQuote]);

  useEffect(() => {
    if (query.data?.price > 0) setBankGoldQuote(query.data);
  }, [query.data, setBankGoldQuote]);

  return { ...query, quote: query.data?.price > 0 ? query.data : bankGoldQuote };
}

export function BankGoldMarketTab({ isActive = false }) {
  const { quote, isFetching, refetch } = useBankGoldQuote(isActive);
  const change = Number(quote?.changePercent) || 0;

  return (
    <main className="asset-market-page bank-gold-market-page" aria-label="黄金行情">
      <section className="asset-market-intro bank-gold-intro glass">
        <div>
          <span className="asset-market-eyebrow">
            <CircleDollarSign size={15} /> 黄金行情
          </span>
          <h1>Au99.99 参考价</h1>
          <p>用于积存金的参考估值；实际赎回金额以浙商银行卖出价为准。</p>
        </div>
        <button type="button" className="bank-gold-refresh" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw size={16} className={isFetching ? 'is-spinning' : ''} />
          {isFetching ? '刷新中' : '刷新'}
        </button>
      </section>
      <section className="bank-gold-quote-panel glass">
        <span>Au99.99</span>
        <strong>{quote?.price > 0 ? `¥${formatNumber(quote.price)} /克` : '暂无行情'}</strong>
        <small className={getValueClass(change)}>
          {formatPercent(change)} · {formatTime(quote?.updatedAt)}
        </small>
      </section>
    </main>
  );
}

export default function BankGoldDashboard({ masked = false, fundSummary = null }) {
  const bankGoldHolding = useStorageStore((state) => state.bankGoldHolding);
  const initBankGoldHolding = useStorageStore((state) => state.initBankGoldHolding);
  const setBankGoldHolding = useStorageStore((state) => state.setBankGoldHolding);
  const { quote, isFetching, refetch } = useBankGoldQuote(true);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const [draft, setDraft] = useState({ grams: '', totalCost: '', manualSellPrice: '' });

  useEffect(() => {
    initBankGoldHolding();
  }, [initBankGoldHolding]);

  useEffect(() => {
    setDraft({
      grams: bankGoldHolding?.grams > 0 ? String(bankGoldHolding.grams) : '',
      totalCost: bankGoldHolding?.totalCost > 0 ? String(bankGoldHolding.totalCost) : '',
      manualSellPrice: bankGoldHolding?.manualSellPrice > 0 ? String(bankGoldHolding.manualSellPrice) : ''
    });
  }, [bankGoldHolding]);

  const metrics = useMemo(() => {
    const grams = Math.max(0, Number(bankGoldHolding?.grams) || 0);
    const totalCost = Math.max(0, Number(bankGoldHolding?.totalCost) || 0);
    const manualPrice = Number(bankGoldHolding?.manualSellPrice) > 0 ? Number(bankGoldHolding.manualSellPrice) : null;
    const referencePrice = Number(quote?.price) > 0 ? Number(quote.price) : null;
    const valuationPrice = manualPrice || referencePrice;
    const asset = valuationPrice ? grams * valuationPrice : null;
    const profit = asset != null && totalCost > 0 ? asset - totalCost : null;
    const profitRate = profit != null && totalCost > 0 ? (profit / totalCost) * 100 : null;
    const averageCost = grams > 0 && totalCost > 0 ? totalCost / grams : null;
    return { grams, totalCost, manualPrice, referencePrice, valuationPrice, asset, profit, profitRate, averageCost };
  }, [bankGoldHolding, quote]);

  const saveHolding = () => {
    const grams = Number(draft.grams);
    const totalCost = Number(draft.totalCost);
    const manualSellPrice = draft.manualSellPrice.trim() ? Number(draft.manualSellPrice) : null;
    if (!Number.isFinite(grams) || grams < 0 || !Number.isFinite(totalCost) || totalCost < 0) {
      setMessage('请输入正确的克数和持仓总成本');
      return;
    }
    if (manualSellPrice != null && (!Number.isFinite(manualSellPrice) || manualSellPrice <= 0)) {
      setMessage('银行卖出价应为大于 0 的数字，不覆盖时请留空');
      return;
    }
    setBankGoldHolding({
      ...bankGoldHolding,
      grams,
      totalCost,
      manualSellPrice,
      manualPriceUpdatedAt: manualSellPrice ? Date.now() : 0
    });
    setMessage('');
    setEditing(false);
  };

  const clearManualPrice = () => {
    setBankGoldHolding({ ...bankGoldHolding, manualSellPrice: null, manualPriceUpdatedAt: 0 });
    setMessage('');
  };

  return (
    <main className="bank-gold-dashboard" aria-label="银行黄金看板">
      <UnifiedAssetOverview fundSummary={fundSummary} masked={masked} className="bank-gold-unified-summary" />

      <section className="bank-gold-hero glass">
        <div className="bank-gold-hero__title">
          <span className="bank-gold-kicker">
            <Landmark size={15} /> 银行黄金
          </span>
          <h1>
            {bankGoldHolding?.bankName || '浙商银行'}·{bankGoldHolding?.productName || '财富金积存'}
          </h1>
          <p>按银行卖出价优先估值，未设置时自动使用 Au99.99 参考价。</p>
        </div>
        <button type="button" className="bank-gold-edit-button" onClick={() => setEditing((value) => !value)}>
          {editing ? <X size={16} /> : <Pencil size={16} />}
          {editing ? '取消' : '编辑持仓'}
        </button>
      </section>

      {editing && (
        <section className="bank-gold-editor glass" aria-label="编辑黄金持仓">
          <div className="bank-gold-editor__fields">
            <label>
              <span>持有克数</span>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.0001"
                  value={draft.grams}
                  onChange={(event) => setDraft((value) => ({ ...value, grams: event.target.value }))}
                  placeholder="例如 12.5680"
                />
                <em>克</em>
              </div>
            </label>
            <label>
              <span>持仓总成本</span>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.totalCost}
                  onChange={(event) => setDraft((value) => ({ ...value, totalCost: event.target.value }))}
                  placeholder="累计购买金额"
                />
                <em>元</em>
              </div>
            </label>
            <label>
              <span>浙商银行卖出价（可选）</span>
              <div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={draft.manualSellPrice}
                  onChange={(event) => setDraft((value) => ({ ...value, manualSellPrice: event.target.value }))}
                  placeholder="留空则使用 Au99.99"
                />
                <em>元/克</em>
              </div>
            </label>
          </div>
          {message && <p className="bank-gold-editor__error">{message}</p>}
          <div className="bank-gold-editor__actions">
            <button type="button" className="bank-gold-save-button" onClick={saveHolding}>
              <Save size={16} /> 保存
            </button>
            {metrics.manualPrice && (
              <button type="button" className="bank-gold-clear-button" onClick={clearManualPrice}>
                清除银行价覆盖
              </button>
            )}
          </div>
        </section>
      )}

      <section className="bank-gold-metrics">
        <article className="bank-gold-metric glass">
          <span>
            <Scale size={16} /> 持有重量
          </span>
          <strong>{masked ? '••••' : `${formatNumber(metrics.grams, 4)} 克`}</strong>
          <small>平均成本 {metrics.averageCost ? `${formatCurrency(metrics.averageCost, masked)} /克` : '—'}</small>
        </article>
        <article className="bank-gold-metric glass">
          <span>
            <CircleDollarSign size={16} /> 参考市值
          </span>
          <strong>{metrics.asset != null ? formatCurrency(metrics.asset, masked) : '—'}</strong>
          <small>{metrics.manualPrice ? '按银行卖出价' : '按 Au99.99 参考价'}</small>
        </article>
        <article className="bank-gold-metric glass">
          <span>
            <ShieldCheck size={16} /> 持有收益
          </span>
          <strong className={getValueClass(metrics.profit)}>
            {metrics.profit != null ? formatCurrency(metrics.profit, masked) : '—'}
          </strong>
          <small className={getValueClass(metrics.profitRate)}>{formatPercent(metrics.profitRate, masked)}</small>
        </article>
      </section>

      <section className="bank-gold-prices glass">
        <div className="bank-gold-prices__header">
          <div>
            <span>估值价格</span>
            <h2>{metrics.valuationPrice ? `¥${formatNumber(metrics.valuationPrice)} /克` : '暂无可用价格'}</h2>
          </div>
          <div className="bank-gold-prices__actions">
            <a
              className="bank-gold-refresh"
              href="https://perbank.czbank.com/PERBANK/pbIndex.jsp?menuFlag=1"
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink size={16} /> 打开浙商银行金价
            </a>
            <button type="button" className="bank-gold-refresh" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw size={16} className={isFetching ? 'is-spinning' : ''} />{' '}
              {isFetching ? '刷新中' : '刷新 Au99.99'}
            </button>
          </div>
        </div>
        <div className="bank-gold-price-grid">
          <div>
            <span>Au99.99 参考价</span>
            <strong>{metrics.referencePrice ? `¥${formatNumber(metrics.referencePrice)} /克` : '获取中…'}</strong>
            <small className={getValueClass(quote?.changePercent)}>
              {formatPercent(quote?.changePercent)} · {formatTime(quote?.updatedAt)}
            </small>
          </div>
          <div className={metrics.manualPrice ? 'is-active' : ''}>
            <span>银行卖出价覆盖</span>
            <strong>{metrics.manualPrice ? `¥${formatNumber(metrics.manualPrice)} /克` : '未设置'}</strong>
            <small>
              {metrics.manualPrice
                ? `手动更新 ${formatTime(bankGoldHolding?.manualPriceUpdatedAt)}`
                : '当前使用公开行情参考估值'}
            </small>
          </div>
        </div>
        <p className="bank-gold-disclaimer">
          可先打开浙商银行页面并手动刷新，再将看到的价格填入“银行卖出价覆盖”。银行积存金买入价、卖出价可存在价差；本页不会登录或读取你的银行账户。
        </p>
      </section>
    </main>
  );
}
