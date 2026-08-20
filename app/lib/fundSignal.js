import { isArray, isBoolean, isFinite as isFiniteNumber, isNumber, isPlainObject } from 'lodash';
import { SUMMARY_TAB_ID } from '@/app/constants';

export const FUND_SIGNAL_GLOBAL_SCOPE = 'all';

export const DEFAULT_FUND_SIGNAL_CONFIG = Object.freeze({
  targetPositionPct: null,
  positionTolerancePct: 2,
  costDrawdownPct: 5,
  costGainPct: 8,
  valuationDropPct: 1,
  valuationRisePct: 1,
  considerDca: true
});

const toFiniteNumber = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return isFiniteNumber(parsed) ? parsed : fallback;
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export const getFundSignalScope = (currentTab) => {
  if (!currentTab || currentTab === 'all' || currentTab === 'fav' || currentTab === SUMMARY_TAB_ID) {
    return FUND_SIGNAL_GLOBAL_SCOPE;
  }
  return String(currentTab);
};

export const normalizeFundSignalConfig = (value) => {
  const raw = isPlainObject(value) ? value : {};
  const target = toFiniteNumber(raw.targetPositionPct);
  return {
    targetPositionPct: target === null ? null : clamp(target, 0, 100),
    positionTolerancePct: clamp(
      toFiniteNumber(raw.positionTolerancePct, DEFAULT_FUND_SIGNAL_CONFIG.positionTolerancePct),
      0,
      100
    ),
    costDrawdownPct: clamp(toFiniteNumber(raw.costDrawdownPct, DEFAULT_FUND_SIGNAL_CONFIG.costDrawdownPct), 0, 100),
    costGainPct: clamp(toFiniteNumber(raw.costGainPct, DEFAULT_FUND_SIGNAL_CONFIG.costGainPct), 0, 1000),
    valuationDropPct: clamp(toFiniteNumber(raw.valuationDropPct, DEFAULT_FUND_SIGNAL_CONFIG.valuationDropPct), 0, 100),
    valuationRisePct: clamp(toFiniteNumber(raw.valuationRisePct, DEFAULT_FUND_SIGNAL_CONFIG.valuationRisePct), 0, 100),
    considerDca: isBoolean(raw.considerDca) ? raw.considerDca : DEFAULT_FUND_SIGNAL_CONFIG.considerDca
  };
};

export const getFundSignalConfig = (fundSignalConfigs, scope, fundCode) => {
  const allConfigs = isPlainObject(fundSignalConfigs) ? fundSignalConfigs : {};
  const exact = allConfigs?.[scope]?.[fundCode];
  const inherited = scope !== FUND_SIGNAL_GLOBAL_SCOPE ? allConfigs?.[FUND_SIGNAL_GLOBAL_SCOPE]?.[fundCode] : null;
  return normalizeFundSignalConfig(exact || inherited);
};

export const hasFundSignalScopeOverride = (fundSignalConfigs, scope, fundCode) =>
  isPlainObject(fundSignalConfigs?.[scope]?.[fundCode]);

export const setFundSignalConfig = (fundSignalConfigs, scope, fundCode, config) => {
  const allConfigs = isPlainObject(fundSignalConfigs) ? fundSignalConfigs : {};
  const scoped = isPlainObject(allConfigs[scope]) ? allConfigs[scope] : {};
  return {
    ...allConfigs,
    [scope]: {
      ...scoped,
      [fundCode]: normalizeFundSignalConfig(config)
    }
  };
};

export const removeFundSignalConfig = (fundSignalConfigs, scope, fundCode) => {
  const allConfigs = isPlainObject(fundSignalConfigs) ? fundSignalConfigs : {};
  if (!isPlainObject(allConfigs[scope]) || !isPlainObject(allConfigs[scope][fundCode])) return allConfigs;

  const nextScope = { ...allConfigs[scope] };
  delete nextScope[fundCode];
  const nextConfigs = { ...allConfigs };
  if (Object.keys(nextScope).length > 0) nextConfigs[scope] = nextScope;
  else delete nextConfigs[scope];
  return nextConfigs;
};

const getIntradayMovePct = (valuationSeries) => {
  if (!isArray(valuationSeries) || valuationSeries.length < 2) return null;
  const first = toFiniteNumber(valuationSeries[0]?.value);
  const last = toFiniteNumber(valuationSeries[valuationSeries.length - 1]?.value);
  if (first === null || last === null || first <= 0) return null;
  return (last / first - 1) * 100;
};

const formatPct = (value, digits = 2) => {
  if (!isNumber(value) || !isFiniteNumber(value)) return '未录入';
  return `${value > 0 ? '+' : ''}${value.toFixed(digits)}%`;
};

/**
 * 生成“观察信号”。结果仅描述用户规则是否被触发，不输出买卖建议。
 */
export const buildFundObservationSignal = ({
  fund,
  holding,
  holdingAmount,
  totalHoldingAmount,
  dcaPlan,
  hasDca,
  valuationSeries,
  config
}) => {
  const normalized = normalizeFundSignalConfig(config);
  const targetPositionPct = normalized.targetPositionPct;
  const amount = toFiniteNumber(holdingAmount);
  const total = toFiniteNumber(totalHoldingAmount);
  const actualPositionPct =
    amount !== null && total !== null && amount >= 0 && total > 0 ? (amount / total) * 100 : null;
  const positionGapPct =
    targetPositionPct !== null && actualPositionPct !== null ? targetPositionPct - actualPositionPct : null;

  const cost = toFiniteNumber(holding?.cost);
  const estimatedNav = !fund?.noValuation ? toFiniteNumber(fund?.gsz) : null;
  const currentNav = estimatedNav !== null && estimatedNav > 0 ? estimatedNav : toFiniteNumber(fund?.dwjz);
  const costReturnPct =
    cost !== null && cost > 0 && currentNav !== null && currentNav > 0 ? (currentNav / cost - 1) * 100 : null;

  const estimateChange = !fund?.noValuation ? toFiniteNumber(fund?.gszzl) : null;
  const confirmedChange = toFiniteNumber(fund?.zzl);
  const recentValuationPct = estimateChange !== null ? estimateChange : confirmedChange;
  const intradayMovePct = getIntradayMovePct(valuationSeries);
  const dcaActive = Boolean(hasDca || dcaPlan?.enabled === true);

  const underweight =
    positionGapPct !== null &&
    positionGapPct > 0 &&
    positionGapPct >= normalized.positionTolerancePct &&
    normalized.positionTolerancePct >= 0;
  const overweight =
    positionGapPct !== null &&
    positionGapPct < 0 &&
    positionGapPct <= -normalized.positionTolerancePct &&
    normalized.positionTolerancePct >= 0;
  const costPullback = costReturnPct !== null && costReturnPct <= -normalized.costDrawdownPct;
  const costGain = costReturnPct !== null && costReturnPct >= normalized.costGainPct;
  const valuationDown = recentValuationPct !== null && recentValuationPct <= -normalized.valuationDropPct;
  const valuationUp = recentValuationPct !== null && recentValuationPct >= normalized.valuationRisePct;
  const dcaSupportsAdd = normalized.considerDca && dcaActive;

  let type = 'hold';
  if (underweight && (costPullback || valuationDown || dcaSupportsAdd)) type = 'add';
  else if (overweight && (costGain || valuationUp)) type = 'reduce';

  const reasons = [];
  if (targetPositionPct === null) {
    reasons.push({ key: 'position', matched: false, text: '尚未录入目标仓位，暂不触发加仓或减仓观察。' });
  } else if (actualPositionPct === null) {
    reasons.push({
      key: 'position',
      matched: false,
      text: `目标仓位 ${targetPositionPct.toFixed(2)}%，但持仓数据不足。`
    });
  } else {
    const direction = positionGapPct > 0 ? '低于' : positionGapPct < 0 ? '高于' : '等于';
    reasons.push({
      key: 'position',
      matched: underweight || overweight,
      text: `当前仓位 ${actualPositionPct.toFixed(2)}%，${direction}目标 ${targetPositionPct.toFixed(2)}% ${Math.abs(positionGapPct).toFixed(2)} 个百分点。`
    });
  }

  reasons.push({
    key: 'cost',
    matched: costPullback || costGain,
    text:
      costReturnPct === null
        ? '未录入有效持仓成本，成本条件不参与判断。'
        : `按录入成本测算 ${formatPct(costReturnPct)}；回撤/浮盈阈值为 ${normalized.costDrawdownPct.toFixed(2)}% / ${normalized.costGainPct.toFixed(2)}%。`
  });
  reasons.push({
    key: 'valuation',
    matched: valuationDown || valuationUp,
    text:
      recentValuationPct === null
        ? '暂无可用的最新估值涨跌，估值条件不参与判断。'
        : `最新估值涨跌 ${formatPct(recentValuationPct)}；下跌/上涨阈值为 ${normalized.valuationDropPct.toFixed(2)}% / ${normalized.valuationRisePct.toFixed(2)}%。`
  });
  reasons.push({
    key: 'dca',
    matched: dcaSupportsAdd,
    text: normalized.considerDca
      ? dcaActive
        ? `当前定投计划已启用${dcaPlan?.amount ? `（每期 ¥${Number(dcaPlan.amount).toFixed(2)}）` : ''}。`
        : '当前未启用定投计划。'
      : '配置为不将定投计划纳入观察条件。'
  });

  const labels = {
    add: '加仓观察',
    hold: '持有观察',
    reduce: '减仓观察'
  };
  const summaries = {
    add: '仓位偏低，且至少一项成本、估值或定投条件已触发。',
    hold:
      targetPositionPct === null
        ? '补充目标仓位后，系统才能对仓位偏离进行比较。'
        : '当前组合条件未同时达到加仓或减仓观察规则。',
    reduce: '仓位偏高，且成本浮盈或估值上涨条件已触发。'
  };

  return {
    type,
    label: labels[type],
    summary: summaries[type],
    reasons,
    metrics: {
      actualPositionPct,
      targetPositionPct,
      positionGapPct,
      costReturnPct,
      recentValuationPct,
      intradayMovePct,
      dcaActive
    },
    config: normalized
  };
};
