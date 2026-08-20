'use client';

import { useRef } from 'react';
import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { DEFAULT_FUND_SIGNAL_CONFIG, normalizeFundSignalConfig } from '../lib/fundSignal';

const FIELD_DEFS = [
  { key: 'targetPositionPct', label: '目标仓位', suffix: '%', placeholder: '例如 15', min: 0, max: 100 },
  { key: 'positionTolerancePct', label: '仓位容差', suffix: '百分点', min: 0, max: 100 },
  { key: 'costDrawdownPct', label: '成本回撤阈值', suffix: '%', min: 0, max: 100 },
  { key: 'costGainPct', label: '成本浮盈阈值', suffix: '%', min: 0, max: 1000 },
  { key: 'valuationDropPct', label: '估值下跌阈值', suffix: '%', min: 0, max: 100 },
  { key: 'valuationRisePct', label: '估值上涨阈值', suffix: '%', min: 0, max: 100 }
];

export default function FundSignalConfigModal({ fundName, scopeName, config, hasOverride, onClose, onSave, onReset }) {
  const formRef = useRef(null);
  const normalizedConfig = normalizeFundSignalConfig(config);
  const valuesRef = useRef({ ...normalizedConfig });

  const handleSave = () => {
    const formElement = formRef.current;
    if (!formElement) return;
    const nextValues = FIELD_DEFS.reduce((result, field) => {
      const input = formElement.elements.namedItem(field.key);
      return {
        ...result,
        [field.key]: input?.value ?? valuesRef.current[field.key]
      };
    }, {});
    const dcaInput = formElement.elements.namedItem('considerDca');
    const target = nextValues.targetPositionPct;
    onSave?.(
      normalizeFundSignalConfig({
        ...nextValues,
        considerDca: dcaInput?.checked ?? valuesRef.current.considerDca,
        targetPositionPct: target === '' || target === null ? null : Number(target)
      })
    );
  };

  const restoreDefaultThresholds = () => {
    const formElement = formRef.current;
    if (!formElement) return;
    FIELD_DEFS.forEach((field) => {
      if (field.key === 'targetPositionPct') return;
      const input = formElement.elements.namedItem(field.key);
      if (input) {
        input.value = DEFAULT_FUND_SIGNAL_CONFIG[field.key];
        valuesRef.current[field.key] = DEFAULT_FUND_SIGNAL_CONFIG[field.key];
      }
    });
    const dcaInput = formElement.elements.namedItem('considerDca');
    if (dcaInput) {
      dcaInput.checked = DEFAULT_FUND_SIGNAL_CONFIG.considerDca;
      valuesRef.current.considerDca = DEFAULT_FUND_SIGNAL_CONFIG.considerDca;
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose?.()}>
      <DialogContent
        showCloseButton={false}
        className="z-[61] glass card modal fund-signal-modal"
        overlayClassName="modal-overlay"
      >
        <DialogTitle className="sr-only">观察信号配置</DialogTitle>
        <form ref={formRef} onSubmit={(event) => event.preventDefault()}>
          <div className="fund-signal-modal__title">
            <span className="fund-signal-modal__icon">
              <SlidersHorizontal width="20" height="20" />
            </span>
            <div>
              <h2>观察信号配置</h2>
              <p>
                {fundName} · {scopeName}
              </p>
            </div>
          </div>
          <DialogDescription className="sr-only">
            配置目标仓位、成本阈值、估值涨跌阈值和定投观察规则。
          </DialogDescription>

          <div className="fund-signal-modal__note">
            仓位偏离是必要条件；成本、估值或定投至少再触发一项，才会出现“加仓观察/减仓观察”。
          </div>

          <div className="fund-signal-modal__grid">
            {FIELD_DEFS.map((field) => (
              <label key={field.key}>
                <span>{field.label}</span>
                <div>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={field.min}
                    max={field.max}
                    step="0.1"
                    name={field.key}
                    defaultValue={normalizedConfig[field.key] ?? ''}
                    placeholder={field.placeholder}
                    onInput={(event) => {
                      valuesRef.current[field.key] = event.currentTarget.value;
                    }}
                  />
                  <small>{field.suffix}</small>
                </div>
              </label>
            ))}
          </div>

          <label className="fund-signal-modal__switch">
            <input
              type="checkbox"
              name="considerDca"
              defaultChecked={normalizedConfig.considerDca === true}
              onChange={(event) => {
                valuesRef.current.considerDca = event.currentTarget.checked;
              }}
            />
            <span>
              <b>将启用中的定投计划纳入观察</b>
              <small>定投只作为加仓观察的佐证，不会单独触发信号。</small>
            </span>
          </label>

          <p className="fund-signal-modal__disclaimer">
            本功能仅按你设定的规则整理信息，不预测收益，也不构成投资建议。
          </p>

          <div className="fund-signal-modal__actions">
            <button type="button" className="button secondary" onClick={restoreDefaultThresholds}>
              恢复默认阈值
            </button>
            {hasOverride ? (
              <button type="button" className="button secondary" onClick={onReset}>
                <RotateCcw width="14" height="14" /> 清除本作用域配置
              </button>
            ) : null}
            <span className="fund-signal-modal__actions-spacer" />
            <button type="button" className="button secondary" onClick={onClose}>
              取消
            </button>
            <button type="button" className="button primary" onClick={handleSave}>
              保存
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
