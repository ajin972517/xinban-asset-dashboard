'use client';

import { useEffect, useMemo, useState } from 'react';
import { isArray } from 'lodash';
import { BarChart3, RefreshCw } from 'lucide-react';

import { fetchStockKline, fetchStockMinute } from '@/app/api/stock';

const WIDTH = 720;
const HEIGHT = 238;
const PADDING = { top: 20, right: 18, bottom: 28, left: 48 };

const formatPrice = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(number >= 1000 ? 2 : 3) : '—';
};

const getBounds = (values) => {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return { min: 0, max: 1 };
  let min = Math.min(...valid);
  let max = Math.max(...valid);
  if (min === max) {
    min -= Math.abs(min || 1) * 0.01;
    max += Math.abs(max || 1) * 0.01;
  }
  const padding = (max - min) * 0.08;
  return { min: min - padding, max: max + padding };
};

export default function StockChart({ stock }) {
  const [mode, setMode] = useState('minute');
  const [range, setRange] = useState(66);
  const [points, setPoints] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const next =
          mode === 'minute' ? await fetchStockMinute(stock?.code) : await fetchStockKline(stock?.code, range);
        if (cancelled) return;
        setPoints(isArray(next) ? next : []);
        if (!isArray(next) || next.length === 0) setError('当前市场暂时没有可用图表数据');
      } catch (loadError) {
        if (!cancelled) {
          setPoints([]);
          setError(loadError?.message || '图表加载失败');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [mode, range, stock?.code]);

  const chart = useMemo(() => {
    const chartWidth = WIDTH - PADDING.left - PADDING.right;
    const chartHeight = HEIGHT - PADDING.top - PADDING.bottom;
    if (!isArray(points) || points.length === 0) return null;

    if (mode === 'minute') {
      const bounds = getBounds(points.map((point) => Number(point.price)));
      const toX = (index) => PADDING.left + (index / Math.max(1, points.length - 1)) * chartWidth;
      const toY = (value) => PADDING.top + ((bounds.max - value) / (bounds.max - bounds.min)) * chartHeight;
      const path = points
        .map((point, index) => `${index === 0 ? 'M' : 'L'} ${toX(index).toFixed(2)} ${toY(point.price).toFixed(2)}`)
        .join(' ');
      const areaPath = `${path} L ${toX(points.length - 1).toFixed(2)} ${PADDING.top + chartHeight} L ${PADDING.left} ${PADDING.top + chartHeight} Z`;
      return { type: 'minute', bounds, path, areaPath, toY };
    }

    const bounds = getBounds(points.flatMap((point) => [Number(point.high), Number(point.low)]));
    const candleSlot = chartWidth / Math.max(1, points.length);
    const bodyWidth = Math.max(1, Math.min(8, candleSlot * 0.62));
    const toY = (value) => PADDING.top + ((bounds.max - value) / (bounds.max - bounds.min)) * chartHeight;
    const candles = points.map((point, index) => ({
      ...point,
      x: PADDING.left + index * candleSlot + candleSlot / 2,
      bodyWidth,
      openY: toY(point.open),
      closeY: toY(point.close),
      highY: toY(point.high),
      lowY: toY(point.low),
      up: point.close >= point.open
    }));
    return { type: 'kline', bounds, candles, toY };
  }, [mode, points]);

  const latest = points.length > 0 ? points[points.length - 1] : null;
  const first = points.length > 0 ? points[0] : null;
  const periodChange =
    mode === 'minute'
      ? first?.price > 0
        ? ((Number(latest?.price) - Number(first.price)) / Number(first.price)) * 100
        : null
      : first?.open > 0
        ? ((Number(latest?.close) - Number(first.open)) / Number(first.open)) * 100
        : null;

  return (
    <section className="stock-chart-panel" aria-label={`${stock?.name || '股票'}行情图表`}>
      <div className="stock-chart-panel__header">
        <div>
          <div className="stock-chart-panel__title">
            <BarChart3 size={16} aria-hidden="true" />
            行情走势
          </div>
          <span>{mode === 'minute' ? '当日分时' : `${points.length} 个交易日 · 前复权`}</span>
        </div>
        <div className="stock-chart-controls">
          <button type="button" className={mode === 'minute' ? 'active' : ''} onClick={() => setMode('minute')}>
            分时
          </button>
          <button
            type="button"
            className={mode === 'kline' && range === 22 ? 'active' : ''}
            onClick={() => {
              setMode('kline');
              setRange(22);
            }}
          >
            近1月
          </button>
          <button
            type="button"
            className={mode === 'kline' && range === 66 ? 'active' : ''}
            onClick={() => {
              setMode('kline');
              setRange(66);
            }}
          >
            近3月
          </button>
          <button
            type="button"
            className={mode === 'kline' && range === 250 ? 'active' : ''}
            onClick={() => {
              setMode('kline');
              setRange(250);
            }}
          >
            近1年
          </button>
        </div>
      </div>

      {loading ? (
        <div className="stock-chart-state">
          <RefreshCw size={18} className="stock-spin" aria-hidden="true" />
          加载行情图表…
        </div>
      ) : error || !chart ? (
        <div className="stock-chart-state">{error || '暂无图表数据'}</div>
      ) : (
        <>
          <div className="stock-chart-stats">
            <span>
              最新 <strong>{formatPrice(mode === 'minute' ? latest?.price : latest?.close)}</strong>
            </span>
            <span>
              区间{' '}
              <strong className={periodChange > 0 ? 'stock-value-up' : periodChange < 0 ? 'stock-value-down' : ''}>
                {periodChange == null ? '—' : `${periodChange > 0 ? '+' : ''}${periodChange.toFixed(2)}%`}
              </strong>
            </span>
            <span>
              最高 <strong>{formatPrice(chart.bounds.max)}</strong>
            </span>
            <span>
              最低 <strong>{formatPrice(chart.bounds.min)}</strong>
            </span>
          </div>
          <div className="stock-chart-svg-wrap">
            <svg className="stock-chart-svg" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="股票价格走势">
              <defs>
                <linearGradient id={`stock-area-${stock.code}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[0, 0.5, 1].map((ratio) => {
                const y = PADDING.top + ratio * (HEIGHT - PADDING.top - PADDING.bottom);
                const value = chart.bounds.max - ratio * (chart.bounds.max - chart.bounds.min);
                return (
                  <g key={ratio}>
                    <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y} y2={y} className="stock-chart-grid" />
                    <text x={PADDING.left - 7} y={y + 4} textAnchor="end" className="stock-chart-axis-label">
                      {formatPrice(value)}
                    </text>
                  </g>
                );
              })}
              {chart.type === 'minute' ? (
                <>
                  <path d={chart.areaPath} fill={`url(#stock-area-${stock.code})`} />
                  <path d={chart.path} className="stock-chart-line" />
                  <text x={PADDING.left} y={HEIGHT - 8} className="stock-chart-axis-label">
                    {points[0]?.label}
                  </text>
                  <text x={WIDTH - PADDING.right} y={HEIGHT - 8} textAnchor="end" className="stock-chart-axis-label">
                    {latest?.label}
                  </text>
                </>
              ) : (
                <>
                  {chart.candles.map((candle) => {
                    const bodyTop = Math.min(candle.openY, candle.closeY);
                    const bodyHeight = Math.max(1, Math.abs(candle.closeY - candle.openY));
                    return (
                      <g key={candle.date} className={candle.up ? 'stock-candle-up' : 'stock-candle-down'}>
                        <line x1={candle.x} x2={candle.x} y1={candle.highY} y2={candle.lowY} />
                        <rect
                          x={candle.x - candle.bodyWidth / 2}
                          y={bodyTop}
                          width={candle.bodyWidth}
                          height={bodyHeight}
                        />
                      </g>
                    );
                  })}
                  <text x={PADDING.left} y={HEIGHT - 8} className="stock-chart-axis-label">
                    {points[0]?.date?.slice(5)}
                  </text>
                  <text x={WIDTH - PADDING.right} y={HEIGHT - 8} textAnchor="end" className="stock-chart-axis-label">
                    {latest?.date?.slice(5)}
                  </text>
                </>
              )}
            </svg>
          </div>
        </>
      )}
    </section>
  );
}
