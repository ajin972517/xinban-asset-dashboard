'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isArray, isNil, isPlainObject } from 'lodash';
import {
  BarChart3,
  CircleDollarSign,
  Cloud,
  FolderPlus,
  History,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  TrendingDown,
  TrendingUp,
  WalletCards,
  X
} from 'lucide-react';

import { fetchStockQuotes, getStockDisplayCode, normalizeStockCode } from '@/app/api/stock';
import {
  calculateStockTradeFees,
  detectStockSecurityType,
  normalizeStockFeeSettings,
  roundMoney
} from '@/app/lib/stockFees';
import { storageStore, useStorageStore } from '@/app/stores';
import StockChart from './StockChart';
import UnifiedAssetOverview from './UnifiedAssetOverview';

const AUTO_REFRESH_MS = 30000;
const STOCK_KEYS = ['stocks', 'stockGroups', 'stockTransactions', 'stockDividends'];
const CURRENCY_META = {
  CNY: { label: '人民币账户', symbol: '¥' },
  HKD: { label: '港股账户', symbol: 'HK$' },
  USD: { label: '美股账户', symbol: '$' }
};

const getToday = () => new Date().toISOString().slice(0, 10);

const formatNumber = (value, digits = 2) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return number.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const formatCurrency = (value, currency = 'CNY', masked = false) => {
  if (isNil(value) || value === '') return '—';
  if (masked) return '••••••';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  return `${CURRENCY_META[currency]?.symbol || ''}${formatNumber(number)}`;
};

const formatSignedCurrency = (value, currency = 'CNY', masked = false) => {
  if (isNil(value) || value === '') return '—';
  if (masked) return '••••••';
  const number = Number(value);
  if (!Number.isFinite(number)) return '—';
  const symbol = CURRENCY_META[currency]?.symbol || '';
  return `${number > 0 ? '+' : number < 0 ? '-' : ''}${symbol}${formatNumber(Math.abs(number))}`;
};

const getChangeClass = (value) => {
  const number = Number(value);
  if (number > 0) return 'stock-value-up';
  if (number < 0) return 'stock-value-down';
  return '';
};

const normalizeStoredStocks = (value) => {
  if (!isArray(value)) return [];
  return value
    .map((item) => {
      const code = normalizeStockCode(item?.code);
      if (!code) return null;
      return {
        ...item,
        code,
        displayCode: item?.displayCode || getStockDisplayCode(code),
        securityType: detectStockSecurityType(item),
        shares: Number.isFinite(Number(item?.shares)) ? Math.max(0, Number(item.shares)) : 0,
        costPrice: Number.isFinite(Number(item?.costPrice)) ? Math.max(0, Number(item.costPrice)) : 0,
        groupId: String(item?.groupId || '')
      };
    })
    .filter(Boolean);
};

const normalizeGroups = (value) =>
  isArray(value)
    ? value
        .map((group) => ({ id: String(group?.id || ''), name: String(group?.name || '').trim() }))
        .filter((group) => group.id && group.name)
    : [];

const getEntryList = (map, code) => (isArray(map?.[code]) ? map[code] : []);

const createLedgerDraft = (price = '') => ({
  date: getToday(),
  shares: '',
  price,
  feeMode: 'auto',
  manualFee: '',
  otherFee: '',
  amount: '',
  note: ''
});

const getEntryFee = (entry) => {
  const fee = Number(entry?.fee);
  return Number.isFinite(fee) && fee >= 0 ? fee : 0;
};

const createId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export default function StockDashboard({
  navbarHeight = 0,
  shouldShowMarketIndex = false,
  masked = false,
  fundSummary = null
}) {
  const {
    stocks,
    stockGroups,
    stockTransactions,
    stockDividends,
    customSettings,
    setStocks,
    setStockGroups,
    setStockTransactions,
    setStockDividends,
    setCustomSettings,
    initStocks,
    initStockGroups,
    initStockTransactions,
    initStockDividends
  } = useStorageStore();
  const [codeInput, setCodeInput] = useState('');
  const [filterText, setFilterText] = useState('');
  const [activeGroupId, setActiveGroupId] = useState('all');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [editingCode, setEditingCode] = useState('');
  const [holdingDraft, setHoldingDraft] = useState({
    shares: '',
    price: '',
    groupId: '',
    securityType: 'stock',
    feeMode: 'included',
    manualFee: '',
    recordTrade: false
  });
  const [feeSettingsOpen, setFeeSettingsOpen] = useState(false);
  const [feeSettingsDraft, setFeeSettingsDraft] = useState(null);
  const [pendingDeleteCode, setPendingDeleteCode] = useState('');
  const [groupDraft, setGroupDraft] = useState('');
  const [ledgerStockCode, setLedgerStockCode] = useState('');
  const [ledgerType, setLedgerType] = useState('buy');
  const [ledgerDraft, setLedgerDraft] = useState(() => createLedgerDraft());
  const [detailCode, setDetailCode] = useState('');
  const stocksRef = useRef([]);
  const deleteTimerRef = useRef(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    stocksRef.current = normalizeStoredStocks(stocks);
  }, [stocks]);

  const persistStocks = useCallback(
    (nextStocks) => {
      const normalized = normalizeStoredStocks(nextStocks);
      stocksRef.current = normalized;
      setStocks(normalized);
    },
    [setStocks]
  );

  const refreshStockList = useCallback(
    async (sourceStocks, { silent = false } = {}) => {
      if (!isArray(sourceStocks) || sourceStocks.length === 0) return;
      if (!silent) setRefreshing(true);
      setError('');
      try {
        const quotes = await fetchStockQuotes(sourceStocks.map((item) => item.code));
        const quoteMap = new Map(quotes.map((quote) => [quote.code, quote]));
        const currentStocks = stocksRef.current;
        persistStocks(
          currentStocks.map((item) => (quoteMap.has(item.code) ? { ...item, ...quoteMap.get(item.code) } : item))
        );
        if (quotes.length === 0) setError('暂时没有取到行情，请稍后重试');
      } catch (fetchError) {
        setError(fetchError?.message || '股票行情刷新失败');
      } finally {
        if (!silent) setRefreshing(false);
      }
    },
    [persistStocks]
  );

  const refreshStocks = useCallback(
    ({ silent = false } = {}) => refreshStockList(stocksRef.current, { silent }),
    [refreshStockList]
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    initStocks();
    initStockGroups();
    initStockTransactions();
    initStockDividends();
    const saved = normalizeStoredStocks(storageStore.getItem('stocks', []));
    stocksRef.current = saved;
    if (saved.length > 0) refreshStockList(saved, { silent: true });
  }, [initStockDividends, initStockGroups, initStockTransactions, initStocks, refreshStockList]);

  useEffect(() => {
    const timer = window.setInterval(() => refreshStocks({ silent: true }), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [refreshStocks]);

  useEffect(() => {
    return () => {
      if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
    };
  }, []);

  const feeSettings = useMemo(() => normalizeStockFeeSettings(customSettings?.stockFeeSettings), [customSettings]);

  const openFeeSettings = useCallback(() => {
    setFeeSettingsDraft({ ...feeSettings });
    setFeeSettingsOpen(true);
  }, [feeSettings]);

  const saveFeeSettings = useCallback(() => {
    const next = normalizeStockFeeSettings(feeSettingsDraft);
    setCustomSettings((current) => ({
      ...(isPlainObject(current) ? current : {}),
      stockFeeSettings: next
    }));
    setFeeSettingsOpen(false);
    setFeeSettingsDraft(null);
  }, [feeSettingsDraft, setCustomSettings]);

  const normalizedGroups = useMemo(() => normalizeGroups(stockGroups), [stockGroups]);

  const addStock = useCallback(async () => {
    const normalizedCode = normalizeStockCode(codeInput);
    if (!normalizedCode) {
      setError('请输入正确的股票代码，例如 600036、00700 或 AAPL');
      return;
    }
    if (stocksRef.current.some((item) => item.code === normalizedCode)) {
      setError('这只股票已经在看板里了');
      return;
    }
    setAdding(true);
    setError('');
    try {
      const [quote] = await fetchStockQuotes([normalizedCode]);
      if (!quote) {
        setError('未找到该股票，请检查代码和市场');
        return;
      }
      persistStocks([
        ...stocksRef.current,
        {
          ...quote,
          shares: 0,
          costPrice: 0,
          groupId: activeGroupId === 'all' ? '' : activeGroupId,
          addedAt: Date.now()
        }
      ]);
      setCodeInput('');
    } catch (fetchError) {
      setError(fetchError?.message || '添加股票失败');
    } finally {
      setAdding(false);
    }
  }, [activeGroupId, codeInput, persistStocks]);

  const addGroup = useCallback(() => {
    const name = groupDraft.trim();
    if (!name) return;
    if (normalizedGroups.some((group) => group.name === name)) {
      setError('已经存在同名股票分组');
      return;
    }
    const group = { id: createId(), name };
    setStockGroups([...normalizedGroups, group]);
    setActiveGroupId(group.id);
    setGroupDraft('');
    setError('');
  }, [groupDraft, normalizedGroups, setStockGroups]);

  const removeGroup = useCallback(
    (groupId) => {
      setStockGroups(normalizedGroups.filter((group) => group.id !== groupId));
      persistStocks(stocksRef.current.map((stock) => (stock.groupId === groupId ? { ...stock, groupId: '' } : stock)));
      setActiveGroupId('all');
    },
    [normalizedGroups, persistStocks, setStockGroups]
  );

  const startEditing = useCallback(
    (stock) => {
      setEditingCode(stock.code);
      setHoldingDraft({
        shares: stock.shares > 0 ? String(stock.shares) : '',
        price: stock.costPrice > 0 ? String(stock.costPrice) : '',
        groupId: stock.groupId || '',
        securityType: detectStockSecurityType(stock),
        feeMode: stock.shares > 0 && stock.costPrice > 0 ? 'included' : 'auto',
        manualFee: '',
        recordTrade: getEntryList(stockTransactions, stock.code).length === 0
      });
    },
    [stockTransactions]
  );

  const saveHolding = useCallback(() => {
    const shares = holdingDraft.shares === '' ? 0 : Number(holdingDraft.shares);
    const price = holdingDraft.price === '' ? 0 : Number(holdingDraft.price);
    const stock = stocksRef.current.find((item) => item.code === editingCode);
    const manualFee = holdingDraft.manualFee === '' ? 0 : Number(holdingDraft.manualFee);
    if (
      !Number.isFinite(shares) ||
      shares < 0 ||
      !Number.isFinite(price) ||
      price < 0 ||
      !Number.isFinite(manualFee) ||
      manualFee < 0
    ) {
      setError('持仓数量和成本价必须是大于或等于 0 的数字');
      return;
    }
    const autoFees = calculateStockTradeFees({
      price,
      shares,
      side: 'buy',
      securityType: holdingDraft.securityType,
      currency: stock?.currency,
      settings: feeSettings
    });
    const totalFee =
      holdingDraft.feeMode === 'auto'
        ? autoFees.totalFee
        : holdingDraft.feeMode === 'manual'
          ? roundMoney(manualFee)
          : 0;
    const costPrice = shares > 0 && holdingDraft.feeMode !== 'included' ? price + totalFee / shares : price;
    persistStocks(
      stocksRef.current.map((item) =>
        item.code === editingCode
          ? {
              ...item,
              shares,
              costPrice,
              securityType: holdingDraft.securityType,
              groupId: holdingDraft.groupId || ''
            }
          : item
      )
    );
    if (holdingDraft.recordTrade && shares > 0 && holdingDraft.feeMode !== 'included') {
      const transactionMap = isPlainObject(stockTransactions) ? stockTransactions : {};
      const currentEntries = getEntryList(transactionMap, editingCode).filter(
        (entry) => !(entry?.isOpeningPosition && entry?.date === getToday())
      );
      const entry = {
        id: createId(),
        type: 'buy',
        date: getToday(),
        shares,
        price,
        fee: totalFee,
        feeMode: holdingDraft.feeMode,
        commission: holdingDraft.feeMode === 'auto' ? autoFees.commission : null,
        transferFee: holdingDraft.feeMode === 'auto' ? autoFees.transferFee : null,
        stampDuty: 0,
        otherFee: holdingDraft.feeMode === 'auto' ? autoFees.otherFee : null,
        grossAmount: autoFees.grossAmount,
        securityType: holdingDraft.securityType,
        isOpeningPosition: true,
        note: '编辑持仓时记录',
        currency: stock?.currency,
        createdAt: Date.now()
      };
      setStockTransactions({ ...transactionMap, [editingCode]: [...currentEntries, entry] });
    }
    setEditingCode('');
    setHoldingDraft({
      shares: '',
      price: '',
      groupId: '',
      securityType: 'stock',
      feeMode: 'included',
      manualFee: '',
      recordTrade: false
    });
    setError('');
  }, [editingCode, feeSettings, holdingDraft, persistStocks, setStockTransactions, stockTransactions]);

  const requestRemove = useCallback(
    (code) => {
      if (pendingDeleteCode === code) {
        persistStocks(stocksRef.current.filter((item) => item.code !== code));
        const nextTransactions = { ...(isPlainObject(stockTransactions) ? stockTransactions : {}) };
        const nextDividends = { ...(isPlainObject(stockDividends) ? stockDividends : {}) };
        delete nextTransactions[code];
        delete nextDividends[code];
        setStockTransactions(nextTransactions);
        setStockDividends(nextDividends);
        setPendingDeleteCode('');
        if (editingCode === code) setEditingCode('');
        if (detailCode === code) setDetailCode('');
        return;
      }
      setPendingDeleteCode(code);
      if (deleteTimerRef.current) window.clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = window.setTimeout(() => setPendingDeleteCode(''), 3000);
    },
    [
      detailCode,
      editingCode,
      pendingDeleteCode,
      persistStocks,
      setStockDividends,
      setStockTransactions,
      stockDividends,
      stockTransactions
    ]
  );

  const openLedger = useCallback((stock, type = 'buy') => {
    setLedgerStockCode(stock.code);
    setLedgerType(type);
    setLedgerDraft(createLedgerDraft(stock.price ? String(stock.price) : ''));
  }, []);

  const saveLedger = useCallback(() => {
    const stock = stocksRef.current.find((item) => item.code === ledgerStockCode);
    if (!stock) return;
    const transactionsMap = isPlainObject(stockTransactions) ? stockTransactions : {};
    const dividendsMap = isPlainObject(stockDividends) ? stockDividends : {};

    if (ledgerType === 'dividend') {
      const amount = Number(ledgerDraft.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        setError('请输入大于 0 的分红金额');
        return;
      }
      const nextEntry = {
        id: createId(),
        type: 'dividend',
        date: ledgerDraft.date || getToday(),
        amount,
        note: ledgerDraft.note.trim(),
        currency: stock.currency,
        createdAt: Date.now()
      };
      setStockDividends({ ...dividendsMap, [stock.code]: [...getEntryList(dividendsMap, stock.code), nextEntry] });
    } else {
      const shares = Number(ledgerDraft.shares);
      const price = Number(ledgerDraft.price);
      const manualFee = ledgerDraft.manualFee === '' ? 0 : Number(ledgerDraft.manualFee);
      const otherFee = ledgerDraft.otherFee === '' ? 0 : Number(ledgerDraft.otherFee);
      if (
        !Number.isFinite(shares) ||
        shares <= 0 ||
        !Number.isFinite(price) ||
        price <= 0 ||
        !Number.isFinite(manualFee) ||
        manualFee < 0 ||
        !Number.isFinite(otherFee) ||
        otherFee < 0
      ) {
        setError('请输入正确的交易数量、价格和手续费');
        return;
      }
      if (ledgerType === 'sell' && shares > Number(stock.shares || 0)) {
        setError('卖出数量不能超过当前持仓');
        return;
      }
      const currentShares = Number(stock.shares || 0);
      const currentCost = Number(stock.costPrice || 0);
      const securityType = detectStockSecurityType(stock);
      const autoFees = calculateStockTradeFees({
        price,
        shares,
        side: ledgerType,
        securityType,
        currency: stock.currency,
        settings: feeSettings,
        otherFee
      });
      const fee = ledgerDraft.feeMode === 'manual' ? roundMoney(manualFee) : autoFees.totalFee;
      let nextShares = currentShares;
      let nextCostPrice = currentCost;
      if (ledgerType === 'buy') {
        nextShares = currentShares + shares;
        nextCostPrice = nextShares > 0 ? (currentShares * currentCost + shares * price + fee) / nextShares : 0;
      } else {
        nextShares = Math.max(0, currentShares - shares);
        nextCostPrice = nextShares > 0 ? currentCost : 0;
      }
      persistStocks(
        stocksRef.current.map((item) =>
          item.code === stock.code ? { ...item, shares: nextShares, costPrice: nextCostPrice } : item
        )
      );
      const nextEntry = {
        id: createId(),
        type: ledgerType,
        date: ledgerDraft.date || getToday(),
        shares,
        price,
        fee,
        feeMode: ledgerDraft.feeMode,
        commission: ledgerDraft.feeMode === 'auto' ? autoFees.commission : null,
        transferFee: ledgerDraft.feeMode === 'auto' ? autoFees.transferFee : null,
        stampDuty: ledgerDraft.feeMode === 'auto' ? autoFees.stampDuty : null,
        otherFee: ledgerDraft.feeMode === 'auto' ? autoFees.otherFee : null,
        grossAmount: autoFees.grossAmount,
        securityType,
        realizedProfit: ledgerType === 'sell' ? shares * (price - currentCost) - fee : null,
        note: ledgerDraft.note.trim(),
        currency: stock.currency,
        createdAt: Date.now()
      };
      setStockTransactions({
        ...transactionsMap,
        [stock.code]: [...getEntryList(transactionsMap, stock.code), nextEntry]
      });
    }
    setLedgerStockCode('');
    setLedgerDraft(createLedgerDraft());
    setError('');
  }, [
    ledgerDraft,
    ledgerStockCode,
    ledgerType,
    feeSettings,
    persistStocks,
    setStockDividends,
    setStockTransactions,
    stockDividends,
    stockTransactions
  ]);

  const deleteLedgerEntry = useCallback(
    (code, entryId, kind) => {
      if (kind === 'dividend') {
        const map = isPlainObject(stockDividends) ? stockDividends : {};
        setStockDividends({ ...map, [code]: getEntryList(map, code).filter((entry) => entry.id !== entryId) });
      } else {
        const map = isPlainObject(stockTransactions) ? stockTransactions : {};
        setStockTransactions({ ...map, [code]: getEntryList(map, code).filter((entry) => entry.id !== entryId) });
      }
    },
    [setStockDividends, setStockTransactions, stockDividends, stockTransactions]
  );

  const rows = useMemo(
    () =>
      normalizeStoredStocks(stocks).map((stock) => {
        const shares = Number(stock.shares) || 0;
        const price = Number(stock.price) || 0;
        const previousClose = Number(stock.previousClose) || 0;
        const costPrice = Number(stock.costPrice) || 0;
        const transactions = getEntryList(stockTransactions, stock.code);
        const todayTransactions = transactions.filter((entry) => entry?.date === getToday());
        const todayBuyShares = todayTransactions
          .filter((entry) => entry?.type === 'buy')
          .reduce((sum, entry) => sum + (Number(entry?.shares) || 0), 0);
        const todaySellShares = todayTransactions
          .filter((entry) => entry?.type === 'sell')
          .reduce((sum, entry) => sum + (Number(entry?.shares) || 0), 0);
        const openingShares = Math.max(0, shares - todayBuyShares + todaySellShares);
        const transactionAwareTodayProfit =
          todayTransactions.length > 0 && previousClose > 0
            ? openingShares * (price - previousClose) +
              todayTransactions.reduce((sum, entry) => {
                const entryShares = Number(entry?.shares) || 0;
                const entryPrice = Number(entry?.price) || 0;
                const fee = getEntryFee(entry);
                if (entry?.type === 'buy') return sum + (price - entryPrice) * entryShares - fee;
                if (entry?.type === 'sell') return sum + (entryPrice - price) * entryShares - fee;
                return sum;
              }, 0)
            : null;
        const dividendTotal = getEntryList(stockDividends, stock.code).reduce(
          (sum, entry) => sum + (Number(entry?.amount) || 0),
          0
        );
        return {
          ...stock,
          shares,
          costPrice,
          marketValue: shares > 0 ? shares * price : null,
          todayProfit:
            transactionAwareTodayProfit != null
              ? transactionAwareTodayProfit
              : shares > 0 && previousClose > 0
                ? shares * (price - previousClose)
                : null,
          totalProfit:
            shares > 0 && costPrice > 0 ? shares * (price - costPrice) + dividendTotal : dividendTotal || null,
          totalProfitPercent:
            shares > 0 && costPrice > 0
              ? ((shares * (price - costPrice) + dividendTotal) / (shares * costPrice)) * 100
              : null,
          dividendTotal
        };
      }),
    [stockDividends, stockTransactions, stocks]
  );

  const visibleRows = useMemo(() => {
    const keyword = filterText.trim().toLowerCase();
    return rows.filter((stock) => {
      if (activeGroupId !== 'all' && stock.groupId !== activeGroupId) return false;
      if (!keyword) return true;
      return (
        String(stock.name || '')
          .toLowerCase()
          .includes(keyword) ||
        String(stock.displayCode || stock.code)
          .toLowerCase()
          .includes(keyword)
      );
    });
  }, [activeGroupId, filterText, rows]);

  const accountSummaries = useMemo(() => {
    const summaries = new Map();
    rows.forEach((stock) => {
      if (stock.marketValue == null) return;
      const currency = stock.currency || 'CNY';
      const current = summaries.get(currency) || {
        currency,
        marketValue: 0,
        todayProfit: 0,
        totalProfit: 0,
        dividend: 0
      };
      current.marketValue += stock.marketValue || 0;
      current.todayProfit += stock.todayProfit || 0;
      current.totalProfit += stock.totalProfit || 0;
      current.dividend += stock.dividendTotal || 0;
      summaries.set(currency, current);
    });
    return Array.from(summaries.values());
  }, [rows]);

  const lastUpdatedAt = useMemo(
    () => Math.max(0, ...normalizeStoredStocks(stocks).map((stock) => Number(stock.quoteUpdatedAt) || 0)),
    [stocks]
  );
  const ledgerStock = rows.find((stock) => stock.code === ledgerStockCode);
  const detailStock = rows.find((stock) => stock.code === detailCode);
  const editingStock = rows.find((stock) => stock.code === editingCode);
  const holdingFeePreview = calculateStockTradeFees({
    price: holdingDraft.price,
    shares: holdingDraft.shares,
    side: 'buy',
    securityType: holdingDraft.securityType,
    currency: editingStock?.currency,
    settings: feeSettings
  });
  const holdingPreviewFee =
    holdingDraft.feeMode === 'auto'
      ? holdingFeePreview.totalFee
      : holdingDraft.feeMode === 'manual'
        ? Math.max(0, Number(holdingDraft.manualFee) || 0)
        : 0;
  const holdingPreviewCost =
    Number(holdingDraft.shares) > 0 && holdingDraft.feeMode !== 'included'
      ? Number(holdingDraft.price || 0) + holdingPreviewFee / Number(holdingDraft.shares)
      : Number(holdingDraft.price || 0);
  const ledgerFeePreview = calculateStockTradeFees({
    price: ledgerDraft.price,
    shares: ledgerDraft.shares,
    side: ledgerType,
    securityType: detectStockSecurityType(ledgerStock),
    currency: ledgerStock?.currency,
    settings: feeSettings,
    otherFee: ledgerDraft.otherFee
  });

  return (
    <section
      className="stock-dashboard"
      style={{ marginTop: shouldShowMarketIndex ? 0 : Number(navbarHeight) || 0 }}
      aria-label="股票看板"
    >
      <div className="stock-dashboard__hero glass">
        <div className="stock-dashboard__intro">
          <div className="stock-dashboard__eyebrow">
            <WalletCards size={16} aria-hidden="true" />
            股票完整版
            <span className="stock-local-badge stock-cloud-badge">
              <Cloud size={13} aria-hidden="true" />
              云端同步
            </span>
          </div>
          <h1>股票资产与交易看板</h1>
          <p>A 股、港股、美股行情、分组、交易、分红、分时与日 K 数据集中管理。</p>
        </div>
        <div className="stock-dashboard__hero-actions">
          <button type="button" className="stock-secondary-button" onClick={openFeeSettings}>
            <Settings2 size={16} aria-hidden="true" />
            交易费用
          </button>
          <button
            type="button"
            className="stock-refresh-button"
            onClick={() => refreshStocks()}
            disabled={refreshing || rows.length === 0}
          >
            <RefreshCw size={16} className={refreshing ? 'stock-spin' : ''} aria-hidden="true" />
            {refreshing ? '刷新中' : '刷新行情'}
          </button>
        </div>
      </div>

      <UnifiedAssetOverview fundSummary={fundSummary} masked={masked} />

      {feeSettingsOpen && feeSettingsDraft && (
        <div className="stock-fee-settings glass">
          <div className="stock-fee-settings__heading">
            <div>
              <span>人民币账户交易费用</span>
              <strong>佣金、过户费与卖出印花税</strong>
            </div>
            <button type="button" onClick={() => setFeeSettingsOpen(false)} aria-label="关闭交易费用设置">
              <X size={16} />
            </button>
          </div>
          <div className="stock-fee-settings__fields">
            <label>
              <span>佣金率（‰）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={feeSettingsDraft.commissionRatePermille}
                onChange={(event) =>
                  setFeeSettingsDraft((current) => ({ ...current, commissionRatePermille: event.target.value }))
                }
              />
            </label>
            <label>
              <span>最低佣金（元）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={feeSettingsDraft.minimumCommission}
                onChange={(event) =>
                  setFeeSettingsDraft((current) => ({ ...current, minimumCommission: event.target.value }))
                }
              />
            </label>
            <label>
              <span>股票过户费（‰）</span>
              <input
                type="number"
                min="0"
                step="0.001"
                inputMode="decimal"
                value={feeSettingsDraft.stockTransferFeePermille}
                onChange={(event) =>
                  setFeeSettingsDraft((current) => ({ ...current, stockTransferFeePermille: event.target.value }))
                }
              />
            </label>
            <label>
              <span>股票卖出印花税（‰）</span>
              <input
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={feeSettingsDraft.stockSellStampDutyPermille}
                onChange={(event) =>
                  setFeeSettingsDraft((current) => ({ ...current, stockSellStampDutyPermille: event.target.value }))
                }
              />
            </label>
          </div>
          <div className="stock-fee-settings__footer">
            <span>ETF 默认只计算佣金；港股和美股请在每笔交易中手动填写实际费用。</span>
            <button type="button" className="stock-primary-button" onClick={saveFeeSettings}>
              保存费用规则
            </button>
          </div>
        </div>
      )}

      <div className="stock-add-panel glass">
        <div className="stock-add-panel__form">
          <div className="stock-input-shell">
            <Search size={17} aria-hidden="true" />
            <input
              className="stock-code-input"
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && addStock()}
              placeholder="输入股票代码：600036 / 00700 / AAPL"
              aria-label="股票代码"
              autoComplete="off"
            />
          </div>
          <button type="button" className="stock-primary-button" onClick={addStock} disabled={adding}>
            {adding ? <RefreshCw size={16} className="stock-spin" /> : <Plus size={16} />}
            {adding ? '查询中' : '添加股票'}
          </button>
        </div>
        <div className="stock-add-panel__hint">代码示例：招商银行 600036、腾讯控股 00700、苹果 AAPL</div>
        {error && <div className="stock-error-message">{error}</div>}
      </div>

      {accountSummaries.length > 0 && (
        <div className="stock-summary-grid">
          {accountSummaries.map((summary) => (
            <article key={summary.currency} className="stock-summary-card glass">
              <div className="stock-summary-card__main">
                <div className="stock-summary-card__title">
                  <CircleDollarSign size={17} aria-hidden="true" />
                  {CURRENCY_META[summary.currency]?.label || summary.currency}
                </div>
                <strong>{formatCurrency(summary.marketValue, summary.currency, masked)}</strong>
              </div>
              <div className="stock-summary-card__metrics">
                <span>
                  今日
                  <b className={getChangeClass(summary.todayProfit)}>
                    {formatSignedCurrency(summary.todayProfit, summary.currency, masked)}
                  </b>
                </span>
                <span>
                  累计
                  <b className={getChangeClass(summary.totalProfit)}>
                    {formatSignedCurrency(summary.totalProfit, summary.currency, masked)}
                  </b>
                </span>
                <span>
                  分红<b>{formatCurrency(summary.dividend, summary.currency, masked)}</b>
                </span>
              </div>
            </article>
          ))}
        </div>
      )}

      <div className="stock-groups-panel glass">
        <div className="stock-group-tabs">
          <button
            type="button"
            className={activeGroupId === 'all' ? 'active' : ''}
            onClick={() => setActiveGroupId('all')}
          >
            全部 ({rows.length})
          </button>
          {normalizedGroups.map((group) => (
            <button
              type="button"
              key={group.id}
              className={activeGroupId === group.id ? 'active' : ''}
              onClick={() => setActiveGroupId(group.id)}
            >
              {group.name} ({rows.filter((stock) => stock.groupId === group.id).length})
            </button>
          ))}
        </div>
        <div className="stock-group-create">
          <FolderPlus size={15} />
          <input
            value={groupDraft}
            onChange={(event) => setGroupDraft(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && addGroup()}
            placeholder="新分组名称"
            aria-label="股票分组名称"
          />
          <button type="button" onClick={addGroup}>
            新增
          </button>
          {activeGroupId !== 'all' && (
            <button type="button" className="danger" onClick={() => removeGroup(activeGroupId)}>
              删除当前分组
            </button>
          )}
        </div>
      </div>

      {editingCode && (
        <div className="stock-holding-editor glass">
          <div>
            <span className="stock-holding-editor__label">编辑持仓</span>
            <strong>{rows.find((item) => item.code === editingCode)?.name || getStockDisplayCode(editingCode)}</strong>
          </div>
          <label>
            <span>持仓数量</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={holdingDraft.shares}
              onChange={(event) => setHoldingDraft((current) => ({ ...current, shares: event.target.value }))}
              placeholder="0"
            />
          </label>
          <label>
            <span>{holdingDraft.feeMode === 'included' ? '含费成本价' : '实际成交均价'}</span>
            <input
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              value={holdingDraft.price}
              onChange={(event) => setHoldingDraft((current) => ({ ...current, price: event.target.value }))}
              placeholder="0.00"
            />
          </label>
          <label>
            <span>品种</span>
            <select
              value={holdingDraft.securityType}
              onChange={(event) => setHoldingDraft((current) => ({ ...current, securityType: event.target.value }))}
            >
              <option value="stock">股票</option>
              <option value="etf">ETF</option>
            </select>
          </label>
          <label>
            <span>费用处理</span>
            <select
              value={holdingDraft.feeMode}
              onChange={(event) =>
                setHoldingDraft((current) => ({
                  ...current,
                  feeMode: event.target.value,
                  recordTrade: event.target.value === 'included' ? false : current.recordTrade
                }))
              }
            >
              <option value="included">成本已含费用</option>
              <option value="auto">按规则自动计算</option>
              <option value="manual">手动填写费用</option>
            </select>
          </label>
          {holdingDraft.feeMode !== 'included' && (
            <label>
              <span>{holdingDraft.feeMode === 'auto' ? '自动费用合计' : '费用合计'}</span>
              <input
                type="number"
                min="0"
                step="any"
                inputMode="decimal"
                readOnly={holdingDraft.feeMode === 'auto'}
                value={holdingDraft.feeMode === 'auto' ? holdingPreviewFee.toFixed(2) : holdingDraft.manualFee}
                onChange={(event) => setHoldingDraft((current) => ({ ...current, manualFee: event.target.value }))}
              />
              <small>含费成本价 {formatNumber(holdingPreviewCost, 4)}</small>
            </label>
          )}
          {holdingDraft.feeMode !== 'included' && (
            <label className="stock-holding-editor__record">
              <span>当日盈亏</span>
              <span className="stock-checkbox-row">
                <input
                  type="checkbox"
                  checked={holdingDraft.recordTrade}
                  onChange={(event) =>
                    setHoldingDraft((current) => ({ ...current, recordTrade: event.target.checked }))
                  }
                />
                记录为今日买入
              </span>
            </label>
          )}
          <label>
            <span>所属分组</span>
            <select
              value={holdingDraft.groupId}
              onChange={(event) => setHoldingDraft((current) => ({ ...current, groupId: event.target.value }))}
            >
              <option value="">未分组</option>
              {normalizedGroups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
          <div className="stock-holding-editor__actions">
            <button type="button" className="stock-secondary-button" onClick={() => setEditingCode('')}>
              取消
            </button>
            <button type="button" className="stock-primary-button" onClick={saveHolding}>
              保存持仓
            </button>
          </div>
        </div>
      )}

      {ledgerStock && (
        <div className="stock-ledger-editor glass">
          <div className="stock-ledger-editor__header">
            <div>
              <span>记录交易与分红</span>
              <strong>{ledgerStock.name}</strong>
            </div>
            <button type="button" onClick={() => setLedgerStockCode('')} aria-label="关闭交易编辑">
              <X size={16} />
            </button>
          </div>
          <div className="stock-ledger-type-tabs">
            {[
              ['buy', '买入'],
              ['sell', '卖出'],
              ['dividend', '分红']
            ].map(([value, label]) => (
              <button
                type="button"
                key={value}
                className={ledgerType === value ? 'active' : ''}
                onClick={() => setLedgerType(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="stock-ledger-fields">
            <label>
              <span>日期</span>
              <input
                type="date"
                value={ledgerDraft.date}
                onChange={(event) => setLedgerDraft((current) => ({ ...current, date: event.target.value }))}
              />
            </label>
            {ledgerType === 'dividend' ? (
              <label>
                <span>税后分红金额</span>
                <input
                  aria-label="税后分红金额"
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={ledgerDraft.amount}
                  onChange={(event) => setLedgerDraft((current) => ({ ...current, amount: event.target.value }))}
                />
              </label>
            ) : (
              <>
                <label>
                  <span>股数</span>
                  <input
                    aria-label="交易股数"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={ledgerDraft.shares}
                    onChange={(event) => setLedgerDraft((current) => ({ ...current, shares: event.target.value }))}
                  />
                </label>
                <label>
                  <span>成交价</span>
                  <input
                    aria-label="成交价"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    value={ledgerDraft.price}
                    onChange={(event) => setLedgerDraft((current) => ({ ...current, price: event.target.value }))}
                  />
                </label>
                <label>
                  <span>费用方式</span>
                  <select
                    aria-label="费用方式"
                    value={ledgerDraft.feeMode}
                    onChange={(event) => setLedgerDraft((current) => ({ ...current, feeMode: event.target.value }))}
                  >
                    <option value="auto">按规则自动计算</option>
                    <option value="manual">按交割单填写</option>
                  </select>
                </label>
                <label>
                  <span>{ledgerDraft.feeMode === 'auto' ? '自动费用合计' : '费用合计'}</span>
                  <input
                    aria-label="交易费用合计"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    readOnly={ledgerDraft.feeMode === 'auto'}
                    value={
                      ledgerDraft.feeMode === 'auto' ? ledgerFeePreview.totalFee.toFixed(2) : ledgerDraft.manualFee
                    }
                    onChange={(event) => setLedgerDraft((current) => ({ ...current, manualFee: event.target.value }))}
                  />
                </label>
                {ledgerDraft.feeMode === 'auto' && (
                  <label>
                    <span>其他费用</span>
                    <input
                      aria-label="其他交易费用"
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      value={ledgerDraft.otherFee}
                      onChange={(event) => setLedgerDraft((current) => ({ ...current, otherFee: event.target.value }))}
                      placeholder="0.00"
                    />
                  </label>
                )}
              </>
            )}
            <label>
              <span>备注</span>
              <input
                value={ledgerDraft.note}
                onChange={(event) => setLedgerDraft((current) => ({ ...current, note: event.target.value }))}
                placeholder="可选"
              />
            </label>
          </div>
          {ledgerType !== 'dividend' && ledgerDraft.feeMode === 'auto' && (
            <div className="stock-fee-breakdown">
              <span>成交额 {formatCurrency(ledgerFeePreview.grossAmount, ledgerStock.currency, masked)}</span>
              <span>佣金 {formatCurrency(ledgerFeePreview.commission, ledgerStock.currency, masked)}</span>
              <span>过户费 {formatCurrency(ledgerFeePreview.transferFee, ledgerStock.currency, masked)}</span>
              <span>印花税 {formatCurrency(ledgerFeePreview.stampDuty, ledgerStock.currency, masked)}</span>
              <strong>费用合计 {formatCurrency(ledgerFeePreview.totalFee, ledgerStock.currency, masked)}</strong>
            </div>
          )}
          <div className="stock-ledger-editor__actions">
            <button type="button" className="stock-primary-button" onClick={saveLedger}>
              保存记录
            </button>
          </div>
        </div>
      )}

      {rows.length > 0 && (
        <div className="stock-list-toolbar">
          <div>
            <strong>我的股票</strong>
            <span>
              {visibleRows.length} / {rows.length} 只
            </span>
          </div>
          <div className="stock-filter-shell">
            <Search size={15} aria-hidden="true" />
            <input
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder="筛选名称或代码"
              aria-label="筛选股票"
            />
            {filterText && (
              <button type="button" onClick={() => setFilterText('')} aria-label="清空筛选">
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="stock-empty-state glass">
          <div className="stock-empty-state__icon">
            <TrendingUp size={28} aria-hidden="true" />
          </div>
          <h2>还没有添加股票</h2>
          <p>输入代码建立自选列表，再记录买卖、分红或直接编辑持仓，即可查看完整资产表现。</p>
        </div>
      ) : visibleRows.length === 0 ? (
        <div className="stock-empty-state glass">
          <Search size={26} />
          <h2>没有匹配的股票</h2>
          <p>换一个名称、代码或分组试试。</p>
        </div>
      ) : (
        <div className="stock-full-list">
          {visibleRows.map((stock) => {
            const transactions = getEntryList(stockTransactions, stock.code);
            const dividends = getEntryList(stockDividends, stock.code);
            const groupName = normalizedGroups.find((group) => group.id === stock.groupId)?.name;
            return (
              <article key={stock.code} className="stock-full-card glass">
                <div className="stock-full-card__header">
                  <div className="stock-name-cell">
                    <strong>{stock.name || stock.displayCode}</strong>
                    <span>
                      {stock.marketLabel} · {stock.displayCode}
                      {groupName ? ` · ${groupName}` : ''}
                    </span>
                  </div>
                  <div className={`stock-mobile-card__quote ${getChangeClass(stock.changePercent)}`}>
                    <strong>{formatNumber(stock.price, stock.market === 'hk' ? 3 : 2)}</strong>
                    <span>
                      {stock.changePercent > 0 ? '+' : ''}
                      {formatNumber(stock.changePercent)}%
                    </span>
                  </div>
                </div>
                <div className="stock-full-card__metrics">
                  <div>
                    <span>持仓市值</span>
                    <strong>{formatCurrency(stock.marketValue, stock.currency, masked)}</strong>
                  </div>
                  <div>
                    <span>持仓 / 成本</span>
                    <strong>{stock.shares > 0 ? `${formatNumber(stock.shares, 2)} 股` : '未设置'}</strong>
                    <small>{stock.costPrice > 0 ? formatNumber(stock.costPrice, 3) : '—'}</small>
                  </div>
                  <div>
                    <span>今日盈亏</span>
                    <strong className={getChangeClass(stock.todayProfit)}>
                      {formatSignedCurrency(stock.todayProfit, stock.currency, masked)}
                    </strong>
                  </div>
                  <div>
                    <span>累计盈亏</span>
                    <strong className={getChangeClass(stock.totalProfit)}>
                      {formatSignedCurrency(stock.totalProfit, stock.currency, masked)}
                    </strong>
                    <small>
                      {stock.totalProfitPercent == null
                        ? '—'
                        : `${stock.totalProfitPercent > 0 ? '+' : ''}${formatNumber(stock.totalProfitPercent)}%`}
                    </small>
                  </div>
                  <div>
                    <span>累计分红</span>
                    <strong>{formatCurrency(stock.dividendTotal, stock.currency, masked)}</strong>
                  </div>
                </div>
                <div className="stock-full-card__actions">
                  <button type="button" onClick={() => openLedger(stock, 'buy')}>
                    <ReceiptText size={14} />
                    交易
                  </button>
                  <button type="button" onClick={() => openLedger(stock, 'dividend')}>
                    <CircleDollarSign size={14} />
                    分红
                  </button>
                  <button type="button" onClick={() => setDetailCode(detailCode === stock.code ? '' : stock.code)}>
                    <BarChart3 size={14} />
                    {detailCode === stock.code ? '收起详情' : '图表与记录'}
                  </button>
                  <button type="button" onClick={() => startEditing(stock)} aria-label={`编辑 ${stock.name} 持仓`}>
                    <Pencil size={14} />
                    编辑
                  </button>
                  <button
                    type="button"
                    className={pendingDeleteCode === stock.code ? 'confirming' : ''}
                    onClick={() => requestRemove(stock.code)}
                    aria-label={pendingDeleteCode === stock.code ? `确认删除 ${stock.name}` : `删除 ${stock.name}`}
                  >
                    <Trash2 size={14} />
                    {pendingDeleteCode === stock.code ? '确认删除' : '删除'}
                  </button>
                </div>
                {detailStock?.code === stock.code && (
                  <div className="stock-detail-panel">
                    <StockChart stock={stock} />
                    <div className="stock-ledger-history">
                      <div className="stock-ledger-history__title">
                        <History size={15} />
                        交易与分红记录
                      </div>
                      {[
                        ...transactions.map((entry) => ({ ...entry, kind: 'transaction' })),
                        ...dividends.map((entry) => ({ ...entry, kind: 'dividend' }))
                      ]
                        .sort(
                          (a, b) =>
                            String(b.date).localeCompare(String(a.date)) ||
                            Number(b.createdAt || 0) - Number(a.createdAt || 0)
                        )
                        .map((entry) => (
                          <div key={entry.id} className="stock-ledger-entry">
                            <span className={`stock-ledger-entry__type ${entry.type}`}>
                              {entry.type === 'buy' ? '买入' : entry.type === 'sell' ? '卖出' : '分红'}
                            </span>
                            <span>{entry.date}</span>
                            <strong>
                              {entry.type === 'dividend'
                                ? formatCurrency(entry.amount, stock.currency, masked)
                                : `${formatNumber(entry.shares, 2)} 股 × ${formatNumber(entry.price, 3)}`}
                            </strong>
                            <small>
                              {entry.note ||
                                (entry.fee ? `交易费用 ${formatCurrency(entry.fee, stock.currency, masked)}` : '')}
                            </small>
                            <button
                              type="button"
                              onClick={() => deleteLedgerEntry(stock.code, entry.id, entry.kind)}
                              aria-label="删除记录"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        ))}
                      {transactions.length === 0 && dividends.length === 0 && (
                        <div className="stock-ledger-empty">暂无交易或分红记录</div>
                      )}
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <div className="stock-dashboard__footer">
        腾讯财经行情仅供个人学习与参考，可能存在延迟，不构成任何投资建议。
        <span>云同步数据：{STOCK_KEYS.join('、')}</span>
        {lastUpdatedAt > 0 && (
          <span>最近刷新：{new Date(lastUpdatedAt).toLocaleTimeString('zh-CN', { hour12: false })}</span>
        )}
      </div>
    </section>
  );
}
