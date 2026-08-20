import { isObject, isString } from 'lodash';

export const DEFAULT_STOCK_FEE_SETTINGS = Object.freeze({
  commissionRatePermille: 0.25,
  minimumCommission: 5,
  stockTransferFeePermille: 0.01,
  stockSellStampDutyPermille: 0.5
});

const toNonNegativeNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
};

export const roundMoney = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

export const normalizeStockFeeSettings = (value) => {
  const source = value && isObject(value) ? value : {};
  return {
    commissionRatePermille: toNonNegativeNumber(
      source.commissionRatePermille,
      DEFAULT_STOCK_FEE_SETTINGS.commissionRatePermille
    ),
    minimumCommission: toNonNegativeNumber(source.minimumCommission, DEFAULT_STOCK_FEE_SETTINGS.minimumCommission),
    stockTransferFeePermille: toNonNegativeNumber(
      source.stockTransferFeePermille,
      DEFAULT_STOCK_FEE_SETTINGS.stockTransferFeePermille
    ),
    stockSellStampDutyPermille: toNonNegativeNumber(
      source.stockSellStampDutyPermille,
      DEFAULT_STOCK_FEE_SETTINGS.stockSellStampDutyPermille
    )
  };
};

export const detectStockSecurityType = (stock) => {
  if (stock?.securityType === 'etf') return 'etf';
  if (stock?.securityType === 'stock') return 'stock';

  const name = isString(stock?.name) ? stock.name.toUpperCase() : '';
  if (name.includes('ETF')) return 'etf';

  const displayCode = String(stock?.displayCode || stock?.code || '').replace(/^(?:sh|sz|bj)/i, '');
  if (/^(?:15|16|51|56|58)/.test(displayCode)) return 'etf';
  return 'stock';
};

export const calculateStockTradeFees = ({
  price,
  shares,
  side = 'buy',
  securityType = 'stock',
  currency = 'CNY',
  settings,
  otherFee = 0
}) => {
  const normalizedSettings = normalizeStockFeeSettings(settings);
  const parsedPrice = toNonNegativeNumber(price, 0);
  const parsedShares = toNonNegativeNumber(shares, 0);
  const parsedOtherFee = roundMoney(toNonNegativeNumber(otherFee, 0));
  const grossAmount = roundMoney(parsedPrice * parsedShares);
  const supportsAuto = currency === 'CNY';

  if (!supportsAuto || grossAmount <= 0) {
    return {
      supportsAuto,
      grossAmount,
      commission: 0,
      transferFee: 0,
      stampDuty: 0,
      otherFee: parsedOtherFee,
      totalFee: parsedOtherFee
    };
  }

  const commission = roundMoney(
    Math.max((grossAmount * normalizedSettings.commissionRatePermille) / 1000, normalizedSettings.minimumCommission)
  );
  const isStock = securityType !== 'etf';
  const transferFee = isStock ? roundMoney((grossAmount * normalizedSettings.stockTransferFeePermille) / 1000) : 0;
  const stampDuty =
    isStock && side === 'sell' ? roundMoney((grossAmount * normalizedSettings.stockSellStampDutyPermille) / 1000) : 0;

  return {
    supportsAuto,
    grossAmount,
    commission,
    transferFee,
    stampDuty,
    otherFee: parsedOtherFee,
    totalFee: roundMoney(commission + transferFee + stampDuty + parsedOtherFee)
  };
};
