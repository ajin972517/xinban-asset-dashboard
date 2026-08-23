'use client';

import { useEffect, useRef } from 'react';
import { CalendarSync, CandlestickChart, CircleDollarSign, Gem, Landmark } from 'lucide-react';

export default function AssetTypeSwitch({ value = 'fund', onChange }) {
  const switchRef = useRef(null);

  useEffect(() => {
    const container = switchRef.current;
    const activeButton = container?.querySelector('[aria-selected="true"]');
    if (!container || !activeButton || container.scrollWidth <= container.clientWidth) return;
    const targetLeft = activeButton.offsetLeft - (container.clientWidth - activeButton.clientWidth) / 2;
    container.scrollTo({ left: Math.max(0, targetLeft), behavior: 'smooth' });
  }, [value]);

  return (
    <div ref={switchRef} className="asset-type-switch" role="tablist" aria-label="资产类型">
      <button
        type="button"
        role="tab"
        aria-selected={value === 'fund'}
        className={`asset-type-switch__button ${value === 'fund' ? 'active' : ''}`}
        onClick={() => onChange?.('fund')}
      >
        <Landmark size={14} aria-hidden="true" />
        <span>基金</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'stock'}
        className={`asset-type-switch__button ${value === 'stock' ? 'active' : ''}`}
        onClick={() => onChange?.('stock')}
      >
        <CandlestickChart size={14} aria-hidden="true" />
        <span>股票</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'gold'}
        className={`asset-type-switch__button ${value === 'gold' ? 'active' : ''}`}
        onClick={() => onChange?.('gold')}
      >
        <CircleDollarSign size={14} aria-hidden="true" />
        <span>黄金</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'cs2'}
        className={`asset-type-switch__button ${value === 'cs2' ? 'active' : ''}`}
        onClick={() => onChange?.('cs2')}
      >
        <Gem size={14} aria-hidden="true" />
        <span>CS2</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'subscription'}
        className={`asset-type-switch__button ${value === 'subscription' ? 'active' : ''}`}
        onClick={() => onChange?.('subscription')}
      >
        <CalendarSync size={14} aria-hidden="true" />
        <span>订阅</span>
      </button>
    </div>
  );
}
