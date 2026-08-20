'use client';

import { Settings2 } from 'lucide-react';
import { isFinite as isFiniteNumber } from 'lodash';
import { useModalStore } from '../stores';

const STYLE_BY_TYPE = {
  add: { color: '#0891b2', background: 'rgba(8, 145, 178, 0.10)', border: 'rgba(8, 145, 178, 0.28)' },
  hold: { color: '#b7791f', background: 'rgba(217, 119, 6, 0.10)', border: 'rgba(217, 119, 6, 0.28)' },
  reduce: { color: '#7c3aed', background: 'rgba(124, 58, 237, 0.10)', border: 'rgba(124, 58, 237, 0.28)' }
};

const displayPct = (value) =>
  value === null || value === undefined || !isFiniteNumber(value) ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;

export default function FundSignalCard({ signal, fundCode, fundName, scope = 'all', compact = false }) {
  if (!signal || !fundCode) return null;
  const palette = STYLE_BY_TYPE[signal.type] || STYLE_BY_TYPE.hold;
  const openConfig = (event) => {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    useModalStore.setState({
      fundSignalModal: { open: true, fundCode, fundName: fundName || fundCode, scope }
    });
  };

  if (compact) {
    return (
      <button
        type="button"
        className="fund-signal-compact"
        onClick={openConfig}
        title={`${signal.label}：${signal.summary}\n${signal.reasons.map((item) => item.text).join('\n')}\n仅为规则观察，不构成投资建议。`}
        style={{ color: palette.color, background: palette.background, borderColor: palette.border }}
      >
        {signal.label}
      </button>
    );
  }

  const metrics = signal.metrics;
  return (
    <section
      className="fund-signal-card"
      style={{ background: palette.background, borderColor: palette.border }}
      aria-label={`${fundName || fundCode}观察信号`}
    >
      <div className="fund-signal-card__header">
        <div>
          <span className="fund-signal-card__eyebrow">规则观察</span>
          <strong style={{ color: palette.color }}>{signal.label}</strong>
        </div>
        <button type="button" className="fund-signal-card__settings" onClick={openConfig} aria-label="配置信号规则">
          <Settings2 width="15" height="15" />
          配置
        </button>
      </div>
      <p className="fund-signal-card__summary">{signal.summary}</p>
      <div className="fund-signal-card__metrics">
        <span>
          <small>当前 / 目标仓位</small>
          <b>{`${displayPct(metrics.actualPositionPct)} / ${displayPct(metrics.targetPositionPct)}`}</b>
        </span>
        <span>
          <small>成本收益</small>
          <b>{displayPct(metrics.costReturnPct)}</b>
        </span>
        <span>
          <small>最新估值涨跌</small>
          <b>{displayPct(metrics.recentValuationPct)}</b>
        </span>
        <span>
          <small>定投计划</small>
          <b>{metrics.dcaActive ? '已启用' : '未启用'}</b>
        </span>
      </div>
      <ul className="fund-signal-card__reasons">
        {signal.reasons.map((item) => (
          <li key={item.key} className={item.matched ? 'matched' : ''}>
            {item.text}
          </li>
        ))}
      </ul>
      <p className="fund-signal-card__disclaimer">仅用于记录与观察，不构成投资建议；请结合风险承受能力自行判断。</p>
    </section>
  );
}
