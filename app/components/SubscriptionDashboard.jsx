'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarClock,
  CalendarSync,
  CircleDollarSign,
  Clock3,
  MoreHorizontal,
  Pencil,
  Plus,
  ReceiptText,
  RefreshCw,
  Trash2,
  WalletCards
} from 'lucide-react';

import { fetchSubscriptionExchangeRates } from '@/app/api/exchangeRates';
import {
  calculateSubscriptionCost,
  getDaysUntilRenewal,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_STATUSES
} from '@/app/lib/subscriptions';
import { useModalStore, useStorageStore } from '@/app/stores';

const RATE_MAX_AGE = 24 * 60 * 60 * 1000;

const formatMoney = (value, masked = false) => {
  if (masked) return '¥••••';
  return Number.isFinite(Number(value))
    ? `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : '—';
};

const formatOriginalPrice = (subscription, masked = false) => {
  if (masked) return '••••';
  const symbols = { CNY: '¥', USD: '$', HKD: 'HK$' };
  return `${symbols[subscription.currency] || ''}${Number(subscription.price).toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
};

const getCycleLabel = (subscription) => {
  if (subscription.billingCycle === 'custom') return `每 ${subscription.customDays || '—'} 天`;
  return SUBSCRIPTION_CYCLES.find((item) => item.value === subscription.billingCycle)?.label || '每月';
};

const getRenewalText = (subscription) => {
  if (!subscription.nextRenewalDate) return '未设置续费日期';
  const days = getDaysUntilRenewal(subscription.nextRenewalDate);
  const date = subscription.nextRenewalDate.slice(5).replace('-', '月') + '日';
  if (days == null) return date;
  if (days < 0) return `${date} · 已过期`;
  if (days === 0) return `${date} · 今天续费`;
  return `${date} · ${days} 天后`;
};

export default function SubscriptionDashboard({ masked = false }) {
  const subscriptions = useStorageStore((state) => state.subscriptions);
  const exchangeRates = useStorageStore((state) => state.subscriptionExchangeRates);
  const initSubscriptions = useStorageStore((state) => state.initSubscriptions);
  const initExchangeRates = useStorageStore((state) => state.initSubscriptionExchangeRates);
  const setExchangeRates = useStorageStore((state) => state.setSubscriptionExchangeRates);
  const [statusFilter, setStatusFilter] = useState('current');

  const {
    data: latestRates,
    isError,
    isFetching,
    refetch
  } = useQuery({
    queryKey: ['subscriptionExchangeRates'],
    queryFn: fetchSubscriptionExchangeRates,
    enabled: false,
    retry: 1
  });

  useEffect(() => {
    initSubscriptions();
    initExchangeRates();
  }, [initExchangeRates, initSubscriptions]);

  useEffect(() => {
    if (!exchangeRates.fetchedAt || Date.now() - exchangeRates.fetchedAt >= RATE_MAX_AGE) refetch();
  }, [exchangeRates.fetchedAt, refetch]);

  useEffect(() => {
    if (latestRates) setExchangeRates(latestRates);
  }, [latestRates, setExchangeRates]);

  const rows = useMemo(
    () =>
      subscriptions
        .map((subscription) => ({
          subscription,
          cost: calculateSubscriptionCost(subscription, exchangeRates),
          renewalDays: getDaysUntilRenewal(subscription.nextRenewalDate)
        }))
        .sort((left, right) => {
          const leftInactive = left.subscription.status === 'cancelled' || left.subscription.status === 'paused';
          const rightInactive = right.subscription.status === 'cancelled' || right.subscription.status === 'paused';
          if (leftInactive !== rightInactive) return leftInactive ? 1 : -1;
          const leftDays =
            left.renewalDays != null && left.renewalDays >= 0 ? left.renewalDays : Number.MAX_SAFE_INTEGER;
          const rightDays =
            right.renewalDays != null && right.renewalDays >= 0 ? right.renewalDays : Number.MAX_SAFE_INTEGER;
          return leftDays - rightDays || left.subscription.name.localeCompare(right.subscription.name, 'zh-CN');
        }),
    [exchangeRates, subscriptions]
  );

  const summary = useMemo(() => {
    const currentRows = rows.filter(
      ({ subscription }) => subscription.status === 'active' || subscription.status === 'trial'
    );
    const totals = currentRows.reduce(
      (result, row) => ({
        monthly: result.monthly + (row.cost.monthlyCny || 0),
        daily: result.daily + (row.cost.dailyCny || 0),
        yearly: result.yearly + (row.cost.yearlyCny || 0)
      }),
      { monthly: 0, daily: 0, yearly: 0 }
    );
    const upcoming = currentRows.filter(
      (row) => row.renewalDays != null && row.renewalDays >= 0 && row.renewalDays <= 30
    );
    return { activeCount: currentRows.length, upcomingCount: upcoming.length, ...totals };
  }, [rows]);

  const visibleRows = rows.filter(({ subscription }) => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'inactive') return subscription.status === 'paused' || subscription.status === 'cancelled';
    return subscription.status === 'active' || subscription.status === 'trial';
  });

  const openEditor = (subscriptionId = null) => {
    useModalStore.setState({ subscriptionEditorModal: { open: true, subscriptionId } });
  };

  const openDelete = (subscription) => {
    useModalStore.setState({ subscriptionDeleteConfirm: { id: subscription.id, name: subscription.name } });
  };

  const rateUpdatedText = exchangeRates.fetchedAt
    ? new Date(exchangeRates.fetchedAt).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    : '等待首次更新';

  return (
    <main className="subscription-dashboard" aria-label="订阅支出看板">
      <section className="subscription-hero glass">
        <div className="subscription-hero__copy">
          <span className="subscription-kicker">
            <CalendarSync size={15} /> 持续性支出
          </span>
          <h1>订阅管理</h1>
          <p>把分散的自动续费集中起来，统一折算为人民币月均与日均成本。</p>
          <div className="subscription-rate-row">
            <span>USD/CNY {exchangeRates.rates?.USD ? exchangeRates.rates.USD.toFixed(4) : '—'}</span>
            <span>HKD/CNY {exchangeRates.rates?.HKD ? exchangeRates.rates.HKD.toFixed(4) : '—'}</span>
            <small>更新于 {rateUpdatedText}</small>
          </div>
          {isError && <small className="subscription-rate-error">汇率更新失败，已继续使用本地缓存</small>}
        </div>
        <div className="subscription-hero__actions">
          <button
            type="button"
            className="subscription-secondary-button"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw size={16} className={isFetching ? 'is-spinning' : ''} />
            {isFetching ? '更新中' : '刷新汇率'}
          </button>
          <button type="button" className="subscription-primary-button" onClick={() => openEditor()}>
            <Plus size={17} /> 添加订阅
          </button>
        </div>
      </section>

      <section className="subscription-summary-grid" aria-label="订阅支出摘要">
        <article className="subscription-summary-card glass">
          <span className="subscription-summary-icon">
            <ReceiptText size={18} />
          </span>
          <div>
            <span>活跃订阅</span>
            <strong>{summary.activeCount} 项</strong>
            <small>包含使用中与试用中</small>
          </div>
        </article>
        <article className="subscription-summary-card glass subscription-summary-card--primary">
          <span className="subscription-summary-icon">
            <WalletCards size={18} />
          </span>
          <div>
            <span>月均支出</span>
            <strong>{formatMoney(summary.monthly, masked)}</strong>
            <small>年化 {formatMoney(summary.yearly, masked)}</small>
          </div>
        </article>
        <article className="subscription-summary-card glass">
          <span className="subscription-summary-icon">
            <Clock3 size={18} />
          </span>
          <div>
            <span>日均消耗</span>
            <strong>{formatMoney(summary.daily, masked)}</strong>
            <small>按 365 天标准化</small>
          </div>
        </article>
        <article className="subscription-summary-card glass">
          <span className="subscription-summary-icon">
            <CalendarClock size={18} />
          </span>
          <div>
            <span>30 天内续费</span>
            <strong>{summary.upcomingCount} 项</strong>
            <small>按下次续费日期统计</small>
          </div>
        </article>
      </section>

      <section className="subscription-list-panel glass">
        <div className="subscription-list-head">
          <div>
            <h2>我的订阅</h2>
            <p>金额均按当前汇率折算，仅作为支出参考。</p>
          </div>
          <div className="subscription-filter" role="tablist" aria-label="订阅状态筛选">
            {[
              ['current', '当前'],
              ['inactive', '停用'],
              ['all', '全部']
            ].map(([value, label]) => (
              <button
                type="button"
                role="tab"
                aria-selected={statusFilter === value}
                className={statusFilter === value ? 'active' : ''}
                key={value}
                onClick={() => setStatusFilter(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <div className="subscription-empty">
            <span>
              <CircleDollarSign size={28} />
            </span>
            <h3>{subscriptions.length === 0 ? '还没有记录订阅' : '这个分类下没有订阅'}</h3>
            <p>
              {subscriptions.length === 0
                ? '添加第一项服务后，这里会自动计算月均与日均支出。'
                : '切换筛选条件查看其他订阅。'}
            </p>
            {subscriptions.length === 0 && (
              <button type="button" className="subscription-primary-button" onClick={() => openEditor()}>
                <Plus size={16} /> 添加第一项
              </button>
            )}
          </div>
        ) : (
          <div className="subscription-card-grid">
            {visibleRows.map(({ subscription, cost, renewalDays }) => {
              const status = SUBSCRIPTION_STATUSES.find((item) => item.value === subscription.status);
              const isDueSoon = renewalDays != null && renewalDays >= 0 && renewalDays <= 7;
              return (
                <article
                  className={`subscription-card ${subscription.status === 'paused' || subscription.status === 'cancelled' ? 'is-inactive' : ''}`}
                  key={subscription.id}
                >
                  <div className="subscription-card__top">
                    <div className="subscription-service-icon">{subscription.name.slice(0, 1).toUpperCase()}</div>
                    <div className="subscription-card__identity">
                      <div>
                        <h3>{subscription.name}</h3>
                        <span className={`subscription-status subscription-status--${subscription.status}`}>
                          {status?.label}
                        </span>
                      </div>
                      <p>
                        {subscription.category}
                        {subscription.paymentMethod ? ` · ${subscription.paymentMethod}` : ''}
                      </p>
                    </div>
                    <div className="subscription-card__menu">
                      <MoreHorizontal size={18} aria-hidden="true" />
                      <div>
                        <button type="button" onClick={() => openEditor(subscription.id)}>
                          <Pencil size={14} /> 编辑
                        </button>
                        <button type="button" className="danger" onClick={() => openDelete(subscription)}>
                          <Trash2 size={14} /> 删除
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="subscription-price-row">
                    <div>
                      <span>原始价格</span>
                      <strong>
                        {formatOriginalPrice(subscription, masked)} <small>/ {getCycleLabel(subscription)}</small>
                      </strong>
                    </div>
                    <div>
                      <span>折合人民币</span>
                      <strong>{formatMoney(cost.cycleCny, masked)}</strong>
                    </div>
                  </div>
                  <div className="subscription-cost-strip">
                    <div>
                      <span>月均</span>
                      <strong>{formatMoney(cost.monthlyCny, masked)}</strong>
                    </div>
                    <div>
                      <span>日均</span>
                      <strong>{formatMoney(cost.dailyCny, masked)}</strong>
                    </div>
                    <div>
                      <span>年化</span>
                      <strong>{formatMoney(cost.yearlyCny, masked)}</strong>
                    </div>
                  </div>
                  <footer className="subscription-card__footer">
                    <span className={isDueSoon ? 'is-due-soon' : ''}>
                      <CalendarClock size={14} /> {getRenewalText(subscription)}
                    </span>
                    <span>
                      {subscription.autoRenew ? '自动续费' : '手动续费'}
                      {subscription.exchangeRateOverride ? ' · 自定义汇率' : ''}
                    </span>
                  </footer>
                  {subscription.notes && <p className="subscription-card__notes">{subscription.notes}</p>}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
