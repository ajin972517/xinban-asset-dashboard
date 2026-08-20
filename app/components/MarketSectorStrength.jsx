'use client';

import dayjs from 'dayjs';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import { isArray, isFinite as isFiniteNumber, isNil } from 'lodash';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const DISPLAY_LIMIT = 20;

function toFiniteNumber(value) {
  if (isNil(value) || value === '') return 0;
  const result = Number(value);
  return isFiniteNumber(result) ? result : 0;
}

function getPercentile(value, values) {
  if (values.length <= 1) return 1;
  const lowerOrEqualCount = values.reduce((count, item) => count + (item <= value ? 1 : 0), 0);
  return (lowerOrEqualCount - 1) / (values.length - 1);
}

function getSignal(changePct, netInflow) {
  if (changePct > 0 && netInflow > 0) {
    return { label: '价资共振', tone: 'strong' };
  }
  if (changePct > 0 && netInflow <= 0) {
    return { label: '价格强/资金分歧', tone: 'divergent' };
  }
  if (changePct <= 0 && netInflow > 0) {
    return { label: '资金强/价格分歧', tone: 'divergent' };
  }
  return { label: '价资偏弱', tone: 'weak' };
}

function formatPercent(value) {
  const number = toFiniteNumber(value);
  return `${number > 0 ? '+' : ''}${number.toFixed(2)}%`;
}

function formatAmount(value) {
  if (isNil(value) || value === '') return '--';
  const number = Number(value);
  if (!isFiniteNumber(number)) return '--';
  const amount = number / 100000000;
  return `${amount > 0 ? '+' : ''}${amount.toFixed(2)}亿`;
}

function getUpdateTime(sectors) {
  const latest = sectors.reduce((current, sector) => {
    const parsed = dayjs(sector.update_at);
    if (!parsed.isValid()) return current;
    return !current || parsed.valueOf() > current.valueOf() ? parsed : current;
  }, null);

  return latest ? latest.format('HH:mm:ss') : '--:--:--';
}

function MarketSectorStrengthCard({ item, rank }) {
  const trend = item.changePct > 0 ? 'up' : item.changePct < 0 ? 'down' : 'flat';
  const signal = getSignal(item.changePct, item.netInflow);

  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, delay: Math.min(rank * 0.015, 0.2) }}
      className={cn('market-strength-card', `is-${trend}`)}
      title="综合强度按板块当日涨跌幅（65%）与主力资金净流入（35%）的横向排名计算，仅用于当日比较"
    >
      <div className="market-strength-card-topline">
        <span className="market-strength-rank">#{rank}</span>
        <span className={cn('market-strength-signal', `is-${signal.tone}`)}>{signal.label}</span>
      </div>

      <h3 className="market-strength-name">{item.sector_name}</h3>
      <div className="market-strength-change">{formatPercent(item.changePct)}</div>

      <dl className="market-strength-metrics">
        <div>
          <dt>主力</dt>
          <dd className={cn(item.netInflow > 0 && 'is-up', item.netInflow < 0 && 'is-down')}>
            {formatAmount(item.netInflow)}
          </dd>
        </div>
        <div>
          <dt>成交</dt>
          <dd>{formatAmount(item.turnover)}</dd>
        </div>
      </dl>

      <div className="market-strength-meter" aria-hidden="true">
        <span style={{ width: `${item.strength}%` }} />
      </div>
    </motion.article>
  );
}

export default function MarketSectorStrength({ sectors = [], isLoading = false, onViewAll }) {
  const sectorList = isArray(sectors) ? sectors : [];
  const industrySectors = sectorList.filter((sector) => sector.sector_type === 'industry');
  const priceValues = industrySectors.map((sector) => toFiniteNumber(sector.change_pct));
  const flowValues = industrySectors.map((sector) => toFiniteNumber(sector.net_inflow));

  const rankedSectors = industrySectors.slice(0, DISPLAY_LIMIT).map((sector) => {
    const changePct = toFiniteNumber(sector.change_pct);
    const netInflow = toFiniteNumber(sector.net_inflow);
    const priceStrength = getPercentile(changePct, priceValues);
    const flowStrength = getPercentile(netInflow, flowValues);

    return {
      ...sector,
      changePct,
      netInflow,
      turnover: toFiniteNumber(sector.turnover),
      strength: Math.round((priceStrength * 0.65 + flowStrength * 0.35) * 100)
    };
  });

  return (
    <section className="market-strength-section glass" aria-labelledby="market-strength-title">
      <div className="market-strength-header">
        <div>
          <span className="market-strength-eyebrow">板块资金</span>
          <h2 id="market-strength-title">大板块强弱</h2>
        </div>
        <div className="market-strength-header-actions">
          <span className="market-strength-update">实时/延迟数据 · {getUpdateTime(industrySectors)}</span>
          <button type="button" className="market-strength-more" onClick={onViewAll}>
            全部 <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="market-strength-grid">
        {isLoading ? (
          Array.from({ length: DISPLAY_LIMIT }).map((_, index) => (
            <div className="market-strength-card is-loading" key={`market-strength-skeleton-${index}`}>
              <div className="market-strength-card-topline">
                <Skeleton className="h-3 w-5" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 w-14" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-1 w-full" />
            </div>
          ))
        ) : rankedSectors.length > 0 ? (
          rankedSectors.map((sector, index) => (
            <MarketSectorStrengthCard key={sector.id || sector.sector_id} item={sector} rank={index + 1} />
          ))
        ) : (
          <div className="market-strength-empty">板块数据暂不可用，请稍后刷新</div>
        )}
      </div>
    </section>
  );
}
