'use client';

import FundMarketTab from './MarketTab';
import StockMarketTab from './StockMarketTab';
import Cs2MarketTab from './Cs2MarketTab';
import SubscriptionMarketTab from './SubscriptionMarketTab';
import { BankGoldMarketTab } from './BankGoldDashboard';

export default function AssetMarketTab({ assetType, onAddFund, getFundCardProps, isActive }) {
  if (assetType === 'stock') {
    return <StockMarketTab isActive={isActive} />;
  }

  if (assetType === 'cs2') {
    return <Cs2MarketTab isActive={isActive} />;
  }

  if (assetType === 'gold') {
    return <BankGoldMarketTab isActive={isActive} />;
  }

  if (assetType === 'subscription') {
    return <SubscriptionMarketTab isActive={isActive} />;
  }

  return <FundMarketTab onAddFund={onAddFund} getFundCardProps={getFundCardProps} isActive={isActive} />;
}
