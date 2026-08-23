'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarSync, X } from 'lucide-react';
import { v4 as uuidv4 } from 'uuid';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  SUBSCRIPTION_CATEGORIES,
  SUBSCRIPTION_CURRENCIES,
  SUBSCRIPTION_CYCLES,
  SUBSCRIPTION_STATUSES
} from '@/app/lib/subscriptions';

const EMPTY_FORM = {
  name: '',
  category: 'AI 工具',
  price: '',
  currency: 'CNY',
  billingCycle: 'monthly',
  customDays: '',
  nextRenewalDate: '',
  autoRenew: true,
  status: 'active',
  paymentMethod: '',
  notes: '',
  exchangeRateOverride: ''
};

export default function SubscriptionEditorModal({ subscription, onClose, onSave }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(
      subscription
        ? {
            ...EMPTY_FORM,
            ...subscription,
            price: String(subscription.price ?? ''),
            customDays: subscription.customDays ? String(subscription.customDays) : '',
            exchangeRateOverride: subscription.exchangeRateOverride ? String(subscription.exchangeRateOverride) : ''
          }
        : EMPTY_FORM
    );
    setError('');
  }, [subscription]);

  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const isForeignCurrency = form.currency !== 'CNY';
  const cycleLabel = useMemo(
    () => SUBSCRIPTION_CYCLES.find((item) => item.value === form.billingCycle)?.label || '每月',
    [form.billingCycle]
  );

  const handleSubmit = (event) => {
    event.preventDefault();
    const price = Number(form.price);
    const customDays = Number(form.customDays);
    const exchangeRateOverride = Number(form.exchangeRateOverride);
    if (!form.name.trim()) {
      setError('请输入服务名称');
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      setError('请输入正确的订阅价格');
      return;
    }
    if (form.billingCycle === 'custom' && (!Number.isFinite(customDays) || customDays <= 0)) {
      setError('请输入正确的自定义周期天数');
      return;
    }
    if (form.exchangeRateOverride && (!Number.isFinite(exchangeRateOverride) || exchangeRateOverride <= 0)) {
      setError('手动汇率应大于 0');
      return;
    }

    const now = Date.now();
    onSave({
      ...form,
      id: subscription?.id || uuidv4(),
      name: form.name.trim(),
      price,
      customDays: form.billingCycle === 'custom' ? customDays : null,
      exchangeRateOverride: isForeignCurrency && form.exchangeRateOverride ? exchangeRateOverride : null,
      paymentMethod: form.paymentMethod.trim(),
      notes: form.notes.trim(),
      createdAt: subscription?.createdAt || now,
      updatedAt: now
    });
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        showCloseButton={false}
        className="glass card modal subscription-editor-modal"
        overlayClassName="modal-overlay"
      >
        <DialogTitle className="sr-only">{subscription ? '编辑订阅' : '添加订阅'}</DialogTitle>
        <div className="subscription-editor-modal__header">
          <div>
            <span className="subscription-kicker">
              <CalendarSync size={15} /> 持续性支出
            </span>
            <h2>{subscription ? '编辑订阅' : '添加订阅'}</h2>
          </div>
          <button type="button" className="icon-button" aria-label="关闭" onClick={onClose}>
            <X size={19} />
          </button>
        </div>

        <form className="subscription-form" onSubmit={handleSubmit}>
          <label className="subscription-form__wide">
            <span>服务名称 *</span>
            <input
              className="subscription-input"
              value={form.name}
              onChange={(event) => setField('name', event.target.value)}
              placeholder="例如 ChatGPT Plus"
              autoFocus
            />
          </label>

          <label>
            <span>分类</span>
            <select
              className="subscription-input"
              value={form.category}
              onChange={(event) => setField('category', event.target.value)}
            >
              {SUBSCRIPTION_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>状态</span>
            <select
              className="subscription-input"
              value={form.status}
              onChange={(event) => setField('status', event.target.value)}
            >
              {SUBSCRIPTION_STATUSES.map((status) => (
                <option key={status.value} value={status.value}>
                  {status.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>价格 *</span>
            <input
              className="subscription-input"
              type="number"
              inputMode="decimal"
              min="0"
              step="any"
              value={form.price}
              onChange={(event) => setField('price', event.target.value)}
              placeholder="20.00"
            />
          </label>

          <label>
            <span>货币</span>
            <select
              className="subscription-input"
              value={form.currency}
              onChange={(event) => setField('currency', event.target.value)}
            >
              {SUBSCRIPTION_CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span>扣费周期</span>
            <select
              className="subscription-input"
              value={form.billingCycle}
              onChange={(event) => setField('billingCycle', event.target.value)}
            >
              {SUBSCRIPTION_CYCLES.map((cycle) => (
                <option key={cycle.value} value={cycle.value}>
                  {cycle.label}
                </option>
              ))}
            </select>
          </label>

          {form.billingCycle === 'custom' ? (
            <label>
              <span>周期天数 *</span>
              <input
                className="subscription-input"
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={form.customDays}
                onChange={(event) => setField('customDays', event.target.value)}
                placeholder="例如 45"
              />
            </label>
          ) : (
            <label>
              <span>下次续费日期</span>
              <input
                className="subscription-input"
                type="date"
                value={form.nextRenewalDate}
                onChange={(event) => setField('nextRenewalDate', event.target.value)}
              />
            </label>
          )}

          {form.billingCycle === 'custom' && (
            <label>
              <span>下次续费日期</span>
              <input
                className="subscription-input"
                type="date"
                value={form.nextRenewalDate}
                onChange={(event) => setField('nextRenewalDate', event.target.value)}
              />
            </label>
          )}

          {isForeignCurrency && (
            <label>
              <span>手动汇率（可选）</span>
              <input
                className="subscription-input"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={form.exchangeRateOverride}
                onChange={(event) => setField('exchangeRateOverride', event.target.value)}
                placeholder={`1 ${form.currency} = ? CNY`}
              />
            </label>
          )}

          <label>
            <span>支付方式</span>
            <input
              className="subscription-input"
              value={form.paymentMethod}
              onChange={(event) => setField('paymentMethod', event.target.value)}
              placeholder="例如 Visa、支付宝"
            />
          </label>

          <label className="subscription-form__wide">
            <span>备注</span>
            <textarea
              className="subscription-input subscription-textarea"
              value={form.notes}
              onChange={(event) => setField('notes', event.target.value)}
              placeholder="家庭共享、取消方式等"
              rows={3}
            />
          </label>

          <label className="subscription-auto-renew subscription-form__wide">
            <input
              type="checkbox"
              checked={form.autoRenew}
              onChange={(event) => setField('autoRenew', event.target.checked)}
            />
            <span>自动续费</span>
            <small>{cycleLabel}到期后将继续扣费</small>
          </label>

          {error && <p className="subscription-form__error subscription-form__wide">{error}</p>}

          <div className="subscription-form__actions subscription-form__wide">
            <button type="button" className="button secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button">
              保存订阅
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
