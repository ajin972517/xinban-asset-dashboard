'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import { isArray, isNil, isObject, isString } from 'lodash';
import {
  AlertTriangle,
  Boxes,
  BoxIcon,
  CheckCircle2,
  CircleDollarSign,
  Database,
  ExternalLink,
  Gem,
  PackageCheck,
  PiggyBank,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  TrendingUp
} from 'lucide-react';

import { checkCs2Service, fetchCs2Inventory, fetchCs2Prices, normalizeSteamId64 } from '@/app/api/cs2';
import { useStorageStore } from '@/app/stores';
import UnifiedAssetOverview from './UnifiedAssetOverview';

const EMPTY_SERVICE_STATE = { checked: false, online: false, steamDtConfigured: false, mode: 'cloud' };
const CATEGORY_OPTIONS = [
  { id: 'all', label: '全部' },
  { id: 'weapon', label: '武器与皮肤' },
  { id: 'case', label: '武器箱' },
  { id: 'sticker', label: '印花' },
  { id: 'other', label: '其他' }
];
const SORT_OPTIONS = [
  { id: 'value', label: '总价值' },
  { id: 'price', label: '单价' },
  { id: 'count', label: '数量' },
  { id: 'name', label: '名称' }
];

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatCurrency = (value, masked = false) => {
  if (masked) return '••••••';
  if (isNil(value) || !Number.isFinite(Number(value))) return '—';
  return `¥${formatNumber(Number(value))}`;
};

const formatTime = (timestamp) => {
  const number = Number(timestamp);
  if (!Number.isFinite(number) || number <= 0) return '尚未同步';
  return new Date(number).toLocaleString('zh-CN', { hour12: false });
};

const formatSignedCurrency = (value, masked = false) => {
  if (masked) return '¥••••••';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const sign = number > 0 ? '+' : number < 0 ? '-' : '';
  return `${sign}¥${formatNumber(Math.abs(number))}`;
};

const getWearDisplay = (assets) => {
  const assetList = isArray(assets) ? assets : [];
  const exteriorTag = assetList
    .flatMap((asset) => (isArray(asset?.tags) ? asset.tags : []))
    .find((tag) => String(tag?.category || '').toLowerCase() === 'exterior');
  const values = assetList
    .map((asset) => Number(asset?.floatWear))
    .filter((value) => Number.isFinite(value) && value > 0);
  const grade = String(exteriorTag?.name || '').trim();
  const gradeClass = String(exteriorTag?.internalName || '').toLowerCase();
  if (values.length === 0) return { value: '—', count: 0, grade, gradeClass };
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    value: min === max ? min.toFixed(8) : `${min.toFixed(8)} – ${max.toFixed(8)}`,
    count: values.length,
    grade,
    gradeClass
  };
};

function PurchasePriceField({ itemName, value, onCommit }) {
  const normalizedValue = Number(value) > 0 ? String(value) : '';
  const [draft, setDraft] = useState(normalizedValue);

  useEffect(() => {
    setDraft(normalizedValue);
  }, [normalizedValue]);

  const commit = () => {
    const parsed = Number(
      String(draft || '')
        .replace(/,/g, '')
        .trim()
    );
    if (Number.isFinite(parsed) && parsed > 0) {
      onCommit(parsed);
      setDraft(String(parsed));
      return;
    }
    onCommit(null);
    setDraft('');
  };

  return (
    <label className="cs2-purchase-field">
      <span>平均购入单价</span>
      <div>
        <b>¥</b>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
          inputMode="decimal"
          placeholder="待录入"
          aria-label={`购入单价 ${itemName}`}
        />
      </div>
    </label>
  );
}

const getCategory = (item) => {
  const tags = isArray(item?.tags) ? item.tags : [];
  const typeTag = tags.find((tag) => String(tag?.category || '').toLowerCase() === 'type');
  const typeSource = `${item?.type || ''} ${typeTag?.internalName || ''} ${typeTag?.name || ''}`.toLowerCase();
  const hasWeaponTag = tags.some((tag) => String(tag?.category || '').toLowerCase() === 'weapon');
  if (/weapon case|武器箱/.test(typeSource)) return 'case';
  if (/sticker|印花/.test(typeSource)) return 'sticker';
  if (hasWeaponTag) return 'weapon';
  if (
    /weapon|rifle|pistol|sniper|smg|shotgun|machinegun|knife|gloves|步枪|手枪|狙击|冲锋枪|霰弹枪|机枪|匕首|手套/.test(
      typeSource
    )
  ) {
    return 'weapon';
  }
  return 'other';
};

const getPositiveNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};

const getQuote = (quotes, basis, platform) => {
  const list = (isArray(quotes) ? quotes : []).filter((quote) => quote && isObject(quote));
  const filtered = platform && platform !== 'auto' ? list.filter((quote) => quote.platform === platform) : list;
  const candidates = filtered
    .map((quote) => ({ quote, price: getPositiveNumber(basis === 'bid' ? quote.biddingPrice : quote.sellPrice) }))
    .filter((entry) => entry.price != null);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (basis === 'bid' ? b.price - a.price : a.price - b.price));
  return candidates[0];
};

const buildInventoryRows = (inventoryItems, priceData, settings, purchasePrices = {}) => {
  const grouped = new Map();
  (isArray(inventoryItems) ? inventoryItems : []).forEach((item) => {
    const key = String(item?.marketHashName || item?.assetId || '').trim();
    if (!key) return;
    const current = grouped.get(key);
    if (current) {
      current.amount += Math.max(1, Number(item?.amount) || 1);
      current.assets.push(item);
      current.tradable = current.tradable || Boolean(item?.tradable);
    } else {
      grouped.set(key, {
        ...item,
        amount: Math.max(1, Number(item?.amount) || 1),
        assets: [item],
        category: getCategory(item)
      });
    }
  });

  const priceMap = new Map(
    (isArray(priceData) ? priceData : [])
      .filter((entry) => entry?.marketHashName)
      .map((entry) => [String(entry.marketHashName), isArray(entry.dataList) ? entry.dataList : []])
  );

  return Array.from(grouped.values()).map((item) => {
    const itemKey = String(item.marketHashName || item.assetId || '');
    const quotes = priceMap.get(String(item.marketHashName || '')) || [];
    const useBidPrice = settings?.priceBasis === 'bid';
    const bestSell = getQuote(quotes, 'sell', settings?.pricePlatform);
    const bestBid = getQuote(quotes, 'bid', settings?.pricePlatform);
    const sellPrice = bestSell?.price ?? null;
    const rawBidPrice = bestBid?.price ?? null;
    const bidPrice = sellPrice && rawBidPrice ? Math.min(rawBidPrice, sellPrice) : rawBidPrice;
    const selected = useBidPrice ? bestBid : bestSell;
    const unitPrice = useBidPrice ? bidPrice : sellPrice;
    const spread = sellPrice && bidPrice ? ((sellPrice - bidPrice) / sellPrice) * 100 : null;
    const purchaseUnitPrice = getPositiveNumber(purchasePrices?.[itemKey]);
    const purchaseCost = purchaseUnitPrice == null ? null : purchaseUnitPrice * item.amount;
    const profit = purchaseCost == null || sellPrice == null ? null : sellPrice * item.amount - purchaseCost;
    const profitRate = profit == null || !purchaseCost ? null : (profit / purchaseCost) * 100;
    return {
      ...item,
      quotes,
      unitPrice,
      sellPrice,
      bidPrice,
      totalValue: unitPrice == null ? null : unitPrice * item.amount,
      sellValue: sellPrice == null ? null : sellPrice * item.amount,
      bidValue: bidPrice == null ? null : bidPrice * item.amount,
      quotePlatform: selected?.quote?.platform || '',
      sellCount: Number(bestSell?.quote?.sellCount) || 0,
      biddingCount: Number(bestBid?.quote?.biddingCount) || 0,
      spread,
      itemKey,
      wearDisplay: getWearDisplay(item.assets),
      purchaseUnitPrice,
      purchaseCost,
      profit,
      profitRate
    };
  });
};

function InventoryTrend({ snapshots, masked }) {
  const points = (isArray(snapshots) ? snapshots : []).slice(-14);
  if (points.length < 2) {
    return (
      <div className="cs2-trend-empty">
        <TrendingUp size={18} />
        完成至少两天估值后显示资产趋势
      </div>
    );
  }

  const values = points.map((point) => Number(point.sellValue) || 0);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const polyline = values
    .map((value, index) => {
      const x = 14 + (index / Math.max(1, values.length - 1)) * 392;
      const y = 104 - ((value - min) / range) * 82;
      return `${x},${y}`;
    })
    .join(' ');

  return (
    <div className="cs2-trend-wrap">
      <div className="cs2-trend-head">
        <span>近 {points.length} 次库存估值</span>
        <strong>{formatCurrency(values.at(-1), masked)}</strong>
      </div>
      <svg viewBox="0 0 420 120" role="img" aria-label="CS2 库存估值趋势">
        <defs>
          <linearGradient id="cs2TrendGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={`M ${polyline} L 406,112 L 14,112 Z`} fill="url(#cs2TrendGradient)" />
        <polyline points={polyline} fill="none" stroke="var(--primary)" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <div className="cs2-trend-labels">
        <span>{points[0]?.date}</span>
        <span>{points.at(-1)?.date}</span>
      </div>
    </div>
  );
}

export default function Cs2InventoryDashboard({ masked = false, fundSummary = null }) {
  const {
    cs2Settings,
    cs2Inventory,
    cs2Prices,
    cs2PurchasePrices,
    cs2Snapshots,
    setCs2Settings,
    setCs2Inventory,
    setCs2Prices,
    setCs2PurchasePrices,
    setCs2Snapshots,
    initCs2Settings,
    initCs2Inventory,
    initCs2Prices,
    initCs2PurchasePrices,
    initCs2Snapshots
  } = useStorageStore();
  const [steamIdDraft, setSteamIdDraft] = useState('');
  const [serviceState, setServiceState] = useState(EMPTY_SERVICE_STATE);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [searchText, setSearchText] = useState('');
  const [category, setCategory] = useState('all');
  const [sortBy, setSortBy] = useState('value');

  useEffect(() => {
    initCs2Settings();
    initCs2Inventory();
    initCs2Prices();
    initCs2PurchasePrices();
    initCs2Snapshots();
  }, [initCs2Inventory, initCs2Prices, initCs2PurchasePrices, initCs2Settings, initCs2Snapshots]);

  useEffect(() => {
    setSteamIdDraft(isString(cs2Settings?.steamId) ? cs2Settings.steamId : '');
  }, [cs2Settings?.steamId]);

  const checkService = useCallback(async () => {
    try {
      const health = await checkCs2Service();
      setServiceState({
        checked: true,
        online: true,
        steamDtConfigured: Boolean(health?.steamDtConfigured),
        mode: health?.mode === 'local' ? 'local' : 'cloud'
      });
    } catch {
      setServiceState({ checked: true, online: false, steamDtConfigured: false });
    }
  }, []);

  useEffect(() => {
    checkService();
  }, [checkService]);

  const rows = useMemo(
    () => buildInventoryRows(cs2Inventory?.items, cs2Prices?.data, cs2Settings, cs2PurchasePrices),
    [cs2Inventory?.items, cs2Prices?.data, cs2PurchasePrices, cs2Settings]
  );

  const platformOptions = useMemo(
    () =>
      Array.from(
        new Set(
          (isArray(cs2Prices?.data) ? cs2Prices.data : []).flatMap((entry) =>
            (isArray(entry?.dataList) ? entry.dataList : []).map((quote) => quote?.platform).filter(Boolean)
          )
        )
      ).sort((a, b) => String(a).localeCompare(String(b), 'zh-CN')),
    [cs2Prices?.data]
  );

  const visibleRows = useMemo(() => {
    const keyword = searchText.trim().toLowerCase();
    const filtered = rows.filter((item) => {
      if (category !== 'all' && item.category !== category) return false;
      if (!keyword) return true;
      const source = `${item.name || ''} ${item.marketHashName || ''} ${item.type || ''}`.toLowerCase();
      return source.includes(keyword);
    });
    return filtered.sort((a, b) => {
      if (sortBy === 'name') return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      if (sortBy === 'count') return b.amount - a.amount;
      if (sortBy === 'price') return (b.unitPrice || -1) - (a.unitPrice || -1);
      return (b.totalValue || -1) - (a.totalValue || -1);
    });
  }, [category, rows, searchText, sortBy]);

  const summary = useMemo(() => {
    const itemCount = rows.reduce((sum, item) => sum + item.amount, 0);
    const marketValue = rows.reduce((sum, item) => sum + (item.sellValue || 0), 0);
    const liquidationValue = rows.reduce((sum, item) => sum + (item.bidValue || 0), 0);
    const currentValue = rows.reduce((sum, item) => sum + (item.totalValue || 0), 0);
    const pricedCount = rows.filter((item) => item.unitPrice != null).reduce((sum, item) => sum + item.amount, 0);
    const tradableCount = rows.filter((item) => item.tradable).reduce((sum, item) => sum + item.amount, 0);
    const purchasedRows = rows.filter((item) => item.purchaseCost != null && item.sellValue != null);
    const purchaseCost = purchasedRows.reduce((sum, item) => sum + item.purchaseCost, 0);
    const purchasedMarketValue = purchasedRows.reduce((sum, item) => sum + item.sellValue, 0);
    const profit = purchasedMarketValue - purchaseCost;
    const profitRate = purchaseCost > 0 ? (profit / purchaseCost) * 100 : null;
    const purchasedCount = purchasedRows.reduce((sum, item) => sum + item.amount, 0);
    return {
      itemCount,
      marketValue,
      liquidationValue,
      currentValue,
      pricedCount,
      tradableCount,
      purchaseCost,
      purchasedMarketValue,
      profit,
      profitRate,
      purchasedCount
    };
  }, [rows]);

  const changeSettings = useCallback(
    (patch) => setCs2Settings((current) => ({ ...current, ...patch })),
    [setCs2Settings]
  );

  const changePurchasePrice = useCallback(
    (itemKey, value) => {
      setCs2PurchasePrices((current) => {
        const next = current && isObject(current) && !isArray(current) ? { ...current } : {};
        if (Number(value) > 0) next[itemKey] = Number(value);
        else delete next[itemKey];
        return next;
      });
    },
    [setCs2PurchasePrices]
  );

  const syncInventory = useCallback(async () => {
    const steamId = normalizeSteamId64(steamIdDraft);
    if (!steamId) {
      setError('请输入有效的 17 位 SteamID64，或包含 SteamID64 的个人资料链接');
      return;
    }
    setSyncing(true);
    setError('');
    setWarning('');
    changeSettings({ steamId });

    try {
      const inventory = await fetchCs2Inventory(steamId);
      setCs2Inventory(inventory);
      if (inventory?.warning) setWarning(inventory.warning);
      const marketHashNames = (isArray(inventory?.items) ? inventory.items : [])
        .filter((item) => item?.marketable && item?.marketHashName)
        .map((item) => item.marketHashName);

      try {
        const prices = await fetchCs2Prices(marketHashNames, steamId);
        if (!isArray(prices?.data) || (marketHashNames.length > 0 && prices.data.length === 0)) {
          throw new Error('SteamDT 暂未返回可用报价，请稍后再试。');
        }
        setCs2Prices(prices);
        if (prices?.warning) setWarning(prices.warning);
        const refreshedRows = buildInventoryRows(
          inventory?.items,
          prices?.data,
          {
            ...cs2Settings,
            steamId
          },
          cs2PurchasePrices
        );
        const snapshot = {
          date: new Date().toISOString().slice(0, 10),
          capturedAt: Date.now(),
          sellValue: refreshedRows.reduce((sum, item) => sum + (item.sellValue || 0), 0),
          bidValue: refreshedRows.reduce((sum, item) => sum + (item.bidValue || 0), 0),
          itemCount: refreshedRows.reduce((sum, item) => sum + item.amount, 0)
        };
        setCs2Snapshots((current) => {
          const list = isArray(current) ? current : [];
          const withoutToday = list.filter((item) => item?.date !== snapshot.date);
          return [...withoutToday, snapshot];
        });
      } catch (priceError) {
        setWarning(`${priceError?.message || '价格获取失败'}；库存已成功同步。`);
      }
      await checkService();
    } catch (inventoryError) {
      setError(inventoryError?.message || 'Steam 库存同步失败');
    } finally {
      setSyncing(false);
    }
  }, [
    changeSettings,
    checkService,
    cs2PurchasePrices,
    cs2Settings,
    setCs2Inventory,
    setCs2Prices,
    setCs2Snapshots,
    steamIdDraft
  ]);

  const hasInventory = rows.length > 0;
  const inventoryRefreshLocked = Number(cs2Inventory?.nextRefreshAt) > Date.now();
  const priceCoverage = summary.itemCount > 0 ? (summary.pricedCount / summary.itemCount) * 100 : 0;

  return (
    <main className="cs2-dashboard" aria-label="CS2 饰品库存看板">
      <section className="cs2-hero glass">
        <div className="cs2-hero__content">
          <div className="cs2-eyebrow">
            <Gem size={16} />
            CS2 库存
            <span className="cs2-local-badge">
              <ShieldCheck size={13} /> {serviceState.mode === 'local' ? '本机开发' : '云端数据'}
            </span>
          </div>
          <h1>CS2 饰品库存与估值</h1>
          <p>从公开 Steam 库存同步饰品，使用 SteamDT 多平台报价计算市场估值与快速变现价。</p>
        </div>
        <div className="cs2-service-status">
          <span className={serviceState.online ? 'online' : 'offline'}>
            <Server size={14} />
            {serviceState.online ? (serviceState.mode === 'local' ? '本地服务在线' : '云端服务在线') : '数据服务未连接'}
          </span>
          <span className={serviceState.steamDtConfigured ? 'online' : 'warning'}>
            <Database size={14} />
            {serviceState.steamDtConfigured ? 'SteamDT 已配置' : 'SteamDT 待配置'}
          </span>
        </div>
      </section>

      <UnifiedAssetOverview fundSummary={fundSummary} masked={masked} />

      <section className="cs2-connect-panel glass">
        <div className="cs2-connect-fields">
          <label htmlFor="cs2-steam-id">SteamID64</label>
          <div className="cs2-input-row">
            <input
              id="cs2-steam-id"
              className="cs2-input"
              value={steamIdDraft}
              onChange={(event) => setSteamIdDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') syncInventory();
              }}
              placeholder="输入 17 位 SteamID64"
              inputMode="numeric"
            />
            <button type="button" className="cs2-primary-button" onClick={syncInventory} disabled={syncing}>
              <RefreshCw size={16} className={syncing ? 'cs2-spin' : ''} />
              {syncing ? '正在同步' : inventoryRefreshLocked ? '刷新报价' : hasInventory ? '刷新库存' : '同步库存'}
            </button>
          </div>
          <small>
            Steam 库存每天最多向官方同步一次；当天再次点击只刷新 SteamDT 报价。库存需要设为公开，API Key 仅保存在
            {serviceState.mode === 'local' ? '本机开发环境' : ' Cloudflare Secret'} 中。
          </small>
        </div>

        <div className="cs2-valuation-controls">
          <div>
            <span>估值口径</span>
            <div className="cs2-segmented">
              <button
                type="button"
                className={cs2Settings?.priceBasis !== 'bid' ? 'active' : ''}
                onClick={() => changeSettings({ priceBasis: 'sell' })}
              >
                市场售价
              </button>
              <button
                type="button"
                className={cs2Settings?.priceBasis === 'bid' ? 'active' : ''}
                onClick={() => changeSettings({ priceBasis: 'bid' })}
              >
                快速变现
              </button>
            </div>
          </div>
          <label>
            报价平台
            <select
              className="cs2-select"
              value={cs2Settings?.pricePlatform || 'auto'}
              onChange={(event) => changeSettings({ pricePlatform: event.target.value })}
            >
              <option value="auto">自动选择最优价</option>
              {platformOptions.map((platform) => (
                <option key={platform} value={platform}>
                  {platform}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {error && (
        <div className="cs2-message cs2-message--error">
          <AlertTriangle size={17} /> {error}
        </div>
      )}
      {warning && (
        <div className="cs2-message cs2-message--warning">
          <AlertTriangle size={17} /> {warning}
        </div>
      )}
      {!serviceState.online && serviceState.checked && (
        <div className="cs2-message cs2-message--warning">
          <Server size={17} />
          {serviceState.mode === 'local'
            ? '本地 CS2 数据服务没有运行。请通过项目启动脚本重新启动看板。'
            : 'CS2 云端数据服务暂时不可用，请稍后重试。'}
        </div>
      )}

      <section className="cs2-summary-grid">
        <article className="cs2-summary-card glass cs2-summary-card--primary">
          <div className="cs2-summary-icon">
            <CircleDollarSign size={20} />
          </div>
          <span>{cs2Settings?.priceBasis === 'bid' ? '快速变现估值' : '当前库存估值'}</span>
          <strong>{formatCurrency(summary.currentValue, masked)}</strong>
          <small>已覆盖 {formatNumber(priceCoverage, 0)}% 库存数量</small>
        </article>
        <article className="cs2-summary-card glass">
          <div className="cs2-summary-icon">
            <Boxes size={20} />
          </div>
          <span>库存数量</span>
          <strong>{summary.itemCount.toLocaleString('zh-CN')} 件</strong>
          <small>{rows.length.toLocaleString('zh-CN')} 种不同饰品</small>
        </article>
        <article className="cs2-summary-card glass">
          <div className="cs2-summary-icon">
            <PackageCheck size={20} />
          </div>
          <span>可交易饰品</span>
          <strong>{summary.tradableCount.toLocaleString('zh-CN')} 件</strong>
          <small>以 Steam 当前库存标记为准</small>
        </article>
        <article className="cs2-summary-card glass">
          <div className="cs2-summary-icon">
            <CircleDollarSign size={20} />
          </div>
          <span>市场价 / 求购价</span>
          <strong>{formatCurrency(summary.marketValue, masked)}</strong>
          <small>求购估值 {formatCurrency(summary.liquidationValue, masked)}</small>
        </article>
      </section>

      <section className="cs2-profit-summary glass" aria-label="购入成本与涨跌汇总">
        <div className="cs2-profit-summary__heading">
          <div className="cs2-summary-icon">
            <PiggyBank size={20} />
          </div>
          <div>
            <strong>购入成本与涨跌</strong>
            <span>
              已录入 {summary.purchasedCount.toLocaleString('zh-CN')} / {summary.itemCount.toLocaleString('zh-CN')}{' '}
              件，按市场售价计算
            </span>
          </div>
        </div>
        <div className="cs2-profit-summary__metrics">
          <div>
            <span>已录入成本</span>
            <strong>{summary.purchaseCost > 0 ? formatCurrency(summary.purchaseCost, masked) : '待录入'}</strong>
          </div>
          <div>
            <span>对应市场市值</span>
            <strong>{summary.purchaseCost > 0 ? formatCurrency(summary.purchasedMarketValue, masked) : '—'}</strong>
          </div>
          <div className={summary.profit > 0 ? 'profit' : summary.profit < 0 ? 'loss' : ''}>
            <span>总浮动盈亏</span>
            <strong>{summary.purchaseCost > 0 ? formatSignedCurrency(summary.profit, masked) : '—'}</strong>
            <small>
              {summary.profitRate == null
                ? '录入购入价后自动计算'
                : `${summary.profitRate > 0 ? '+' : ''}${formatNumber(summary.profitRate, 2)}%`}
            </small>
          </div>
        </div>
      </section>

      <section className="cs2-trend-panel glass">
        <InventoryTrend snapshots={cs2Snapshots} masked={masked} />
        <div className="cs2-sync-meta">
          <span>
            <CheckCircle2 size={15} /> 库存更新：{formatTime(cs2Inventory?.fetchedAt)}
          </span>
          <span>
            <Database size={15} /> 价格更新：{formatTime(cs2Prices?.fetchedAt)}
          </span>
        </div>
      </section>

      <section className="cs2-toolbar glass">
        <div className="cs2-search-shell">
          <Search size={17} />
          <input
            className="cs2-input"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder="搜索饰品名称、类型或英文名"
          />
        </div>
        <div className="cs2-category-tabs" role="tablist" aria-label="饰品分类">
          {CATEGORY_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={category === option.id ? 'active' : ''}
              onClick={() => setCategory(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <label className="cs2-sort-control">
          <SlidersHorizontal size={16} />
          <select className="cs2-select" value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
            {SORT_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      {!hasInventory && !syncing ? (
        <section className="cs2-empty-state glass">
          <div>
            <BoxIcon size={34} />
          </div>
          <h2>还没有同步 CS2 库存</h2>
          <p>输入 SteamID64 后即可拉取公开库存。即使尚未配置 SteamDT，也可以先查看饰品和数量。</p>
        </section>
      ) : visibleRows.length === 0 ? (
        <section className="cs2-empty-state glass">
          <div>
            <Search size={30} />
          </div>
          <h2>没有匹配的饰品</h2>
          <p>可以清空搜索词或切换分类。</p>
        </section>
      ) : (
        <section className="cs2-inventory-grid">
          {visibleRows.map((item) => (
            <article key={item.marketHashName || item.assetId} className="cs2-item-card glass">
              <div className="cs2-item-image-wrap">
                {item.iconUrl ? (
                  <Image unoptimized src={item.iconUrl} alt="" width={168} height={126} loading="lazy" />
                ) : (
                  <BoxIcon size={34} />
                )}
                {item.amount > 1 && <span className="cs2-quantity-badge">×{item.amount}</span>}
              </div>
              <div className="cs2-item-body">
                <div className="cs2-item-title-row">
                  <div>
                    <h3 style={item.nameColor ? { color: item.nameColor } : undefined}>{item.name}</h3>
                    <p>{item.type || item.marketHashName}</p>
                  </div>
                  <span className={item.tradable ? 'tradable' : 'locked'}>{item.tradable ? '可交易' : '锁定'}</span>
                </div>
                <div className="cs2-wear-row">
                  <span>磨损</span>
                  <strong>{item.wearDisplay.value}</strong>
                  {item.wearDisplay.grade && <em className={item.wearDisplay.gradeClass}>{item.wearDisplay.grade}</em>}
                  {item.wearDisplay.count > 1 && <small>{item.wearDisplay.count} 件磨损范围</small>}
                  {item.paintSeed != null && item.wearDisplay.count === 1 && <small>模板 {item.paintSeed}</small>}
                </div>
                <div className="cs2-item-values">
                  <div>
                    <span>单价</span>
                    <strong>{formatCurrency(item.unitPrice, masked)}</strong>
                  </div>
                  <div>
                    <span>总价值</span>
                    <strong>{formatCurrency(item.totalValue, masked)}</strong>
                  </div>
                </div>
                <div className="cs2-investment-row">
                  <PurchasePriceField
                    itemName={item.name}
                    value={item.purchaseUnitPrice}
                    onCommit={(value) => changePurchasePrice(item.itemKey, value)}
                  />
                  <div className={`cs2-profit-result ${item.profit > 0 ? 'profit' : item.profit < 0 ? 'loss' : ''}`}>
                    <span>市场涨跌</span>
                    <strong>{item.profit == null ? '待录入' : formatSignedCurrency(item.profit, masked)}</strong>
                    <small>
                      {item.profitRate == null
                        ? '按市场售价计算'
                        : `${item.profitRate > 0 ? '+' : ''}${formatNumber(item.profitRate, 2)}%`}
                    </small>
                  </div>
                </div>
                <div className="cs2-liquidity-row">
                  <span>平台 {item.quotePlatform || '—'}</span>
                  <span>在售 {item.sellCount || '—'}</span>
                  <span>求购 {item.biddingCount || '—'}</span>
                  <span>价差 {item.spread == null ? '—' : `${formatNumber(item.spread, 1)}%`}</span>
                </div>
                <div className="cs2-item-footer">
                  <span>{item.marketHashName}</span>
                  {item.inspectUrl && (
                    <a href={item.inspectUrl} aria-label={`在 CS2 中检视 ${item.name}`}>
                      游戏检视 <ExternalLink size={13} />
                    </a>
                  )}
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      <footer className="cs2-footer">
        Steam 与 SteamDT 数据可能存在延迟；市场估值不等于实际成交金额，仅供个人资产记录参考。
      </footer>
    </main>
  );
}
