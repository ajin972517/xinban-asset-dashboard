'use client';

import { useEffect, useState } from 'react';
import { LoaderCircle, Plus, Search } from 'lucide-react';
import { isArray } from 'lodash';
import { toast as sonnerToast } from 'sonner';

import { fetchStockQuotes, normalizeStockCode } from '@/app/api/stock';
import { useStorageStore } from '@/app/stores';

export default function StockHeaderSearch({ expanded = false, inputRef, onExpandedChange }) {
  const stocks = useStorageStore((state) => state.stocks);
  const setStocks = useStorageStore((state) => state.setStocks);
  const initStocks = useStorageStore((state) => state.initStocks);
  const [codeInput, setCodeInput] = useState('');
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    initStocks();
  }, [initStocks]);

  const addStock = async () => {
    const normalizedCode = normalizeStockCode(codeInput);
    if (!normalizedCode) {
      sonnerToast.error('请输入正确的股票代码，例如 600036、00700 或 AAPL');
      return;
    }

    const currentStocks = isArray(stocks) ? stocks : [];
    if (currentStocks.some((item) => item?.code === normalizedCode)) {
      sonnerToast.info('这只股票已经在看板里了');
      return;
    }

    setAdding(true);
    try {
      const [quote] = await fetchStockQuotes([normalizedCode]);
      if (!quote) {
        sonnerToast.error('未找到该股票，请检查代码和市场');
        return;
      }
      setStocks((latestStocks) => [
        ...(isArray(latestStocks) ? latestStocks : []),
        {
          ...quote,
          shares: 0,
          costPrice: 0,
          groupId: '',
          addedAt: Date.now()
        }
      ]);
      setCodeInput('');
      sonnerToast.success(`已添加 ${quote.name || quote.displayCode}`);
    } catch (error) {
      sonnerToast.error(error?.message || '添加股票失败');
    } finally {
      setAdding(false);
    }
  };

  return (
    <div
      className={`glass add-fund-section navbar-add-fund stock-header-search ${expanded ? 'search-focused' : ''}`}
      role="region"
      aria-label="添加股票"
    >
      <div className="stock-header-search__shell">
        <Search className="stock-header-search__icon" size={17} aria-hidden="true" />
        <input
          ref={inputRef}
          className="stock-header-search__input"
          value={codeInput}
          onChange={(event) => setCodeInput(event.target.value)}
          onFocus={() => onExpandedChange?.(true)}
          onBlur={() => {
            if (!codeInput.trim()) window.setTimeout(() => onExpandedChange?.(false), 120);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') addStock();
          }}
          placeholder="输入股票代码：600036 / 00700 / AAPL"
          aria-label="搜索并添加股票"
          autoComplete="off"
        />
        <button
          type="button"
          className="stock-header-search__submit"
          onClick={addStock}
          disabled={adding || !codeInput.trim()}
          aria-label="添加股票"
        >
          {adding ? <LoaderCircle size={16} className="stock-header-search__spin" /> : <Plus size={16} />}
          <span>添加</span>
        </button>
      </div>
    </div>
  );
}
