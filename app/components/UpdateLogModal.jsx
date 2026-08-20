'use client';

import { useEffect, useState } from 'react';
import { isArray } from 'lodash';
import { useIsMobile } from '@/app/hooks/useIsMobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { CloseIcon } from './Icons';
import dayjs from 'dayjs';
import { withRetry } from '@/app/lib/asyncHelper';

const LOCAL_RELEASES = [
  {
    id: 'xinban-2026-08-20',
    name: 'v2.4.1 · XinBan',
    tag_name: 'v2.4.1-xinban',
    published_at: '2026-08-20T12:00:00+08:00',
    body: [
      '1. 新增黄金资产入口，以及银行积存金首页和行情页。',
      '2. 支持记录克重、总成本和银行卖出价；未填写卖出价时使用 Au99.99 公开行情作为参考。',
      '3. 黄金市值与盈亏纳入统一资产概览，持仓支持本地保存、云同步和导入导出。',
      '4. 修复全量 ESLint 格式与 Hook 依赖问题，并完成生产构建和本地运行验证。'
    ].join('\n')
  },
  {
    id: 'xinban-2026-08-14',
    name: 'XinBan 功能更新',
    tag_name: 'xinban-2026-08-14',
    published_at: '2026-08-14T12:00:00+08:00',
    body: [
      '1. 基金汇总卡片增加昨日、当日、持有和记录期收益，统一收益名称口径。',
      '2. 修复基金自动数据源，改用近期历史误差选择稳定估值来源。',
      '3. 股票与 ETF 支持可配置交易费用，并优化股票账户汇总布局。',
      '4. CS2 行情增加 Steam 官方公告、高市值饰品 Top 10 和同平台 24 小时涨跌。'
    ].join('\n')
  },
  {
    id: 'xinban-2026-08-13',
    name: 'XinBan 首次上线',
    tag_name: 'xinban-2026-08-13',
    published_at: '2026-08-13T12:00:00+08:00',
    body: [
      '1. 基于“基估宝”完成二次开发，拆分基金、股票和 CS2 的首页及行情页。',
      '2. 增加股票持仓、交易、分红、行情图表和多市场支持。',
      '3. 增加 CS2 库存、SteamDT 多平台报价与独立行情页。',
      '4. Steam 库存按北京时间每天最多请求一次，降低官方接口限流风险。'
    ].join('\n')
  }
];

const mergeReleasesByTime = (remoteReleases) =>
  [...LOCAL_RELEASES, ...(isArray(remoteReleases) ? remoteReleases : [])].sort(
    (a, b) => dayjs(b.published_at).valueOf() - dayjs(a.published_at).valueOf()
  );

export default function UpdateLogModal({ open, onOpenChange }) {
  const isMobile = useIsMobile();
  const [releases, setReleases] = useState(LOCAL_RELEASES);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (open) {
      const fetchReleases = async () => {
        setLoading(true);
        setError(null);
        try {
          const data = await withRetry(
            async () => {
              const res = await fetch('https://api.github.com/repos/hzm0321/real-time-fund/releases');
              if (!res.ok) throw new Error('Failed to fetch releases');
              return res.json();
            },
            2,
            500
          );
          setReleases(mergeReleasesByTime(data));
        } catch (err) {
          setError(err.message);
          setReleases(LOCAL_RELEASES);
        } finally {
          setLoading(false);
        }
      };
      fetchReleases();
    }
  }, [open]);

  const content = (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 scrollbar-y-styled" style={{ WebkitOverflowScrolling: 'touch' }}>
      {loading && releases.length === 0 ? (
        <div className="flex justify-center items-center py-8">
          <span
            className="loading-spinner"
            style={{
              width: 24,
              height: 24,
              border: '2px solid var(--muted)',
              borderTopColor: 'var(--primary)',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite'
            }}
          />
        </div>
      ) : releases.length === 0 ? (
        <div className="text-center py-8 text-[var(--muted)]">暂无更新日志</div>
      ) : (
        <div className="space-y-6">
          {loading && <div className="text-xs text-center text-[var(--muted)]">正在同步基估宝上游更新日志…</div>}
          {error && (
            <div className="text-xs text-center text-[var(--warning)]">
              上游更新日志暂时无法同步，当前已显示本项目更新。
            </div>
          )}
          {releases.map((release) => (
            <div key={release.id} className="relative pl-6 border-l-2 border-[var(--border)]">
              <div className="absolute w-3 h-3 bg-[var(--primary)] rounded-full -left-[7px] top-1.5" />
              <div className="mb-2 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-2">
                <h3 className="text-base font-semibold text-[var(--text)]">{release.name || release.tag_name}</h3>
                <span className="text-xs text-[var(--muted)]">{dayjs(release.published_at).format('YYYY-MM-DD')}</span>
              </div>
              <div
                className="text-sm text-[var(--muted-foreground)] whitespace-pre-wrap break-words"
                dangerouslySetInnerHTML={{ __html: release.body?.replace(/\\n/g, '<br />') }}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="glass" style={{ height: '85vh' }}>
          <DrawerHeader className="flex-shrink-0 flex flex-row items-center justify-between gap-2 space-y-0 px-5 pb-3 pt-4 text-left border-b border-[var(--border)]">
            <DrawerTitle className="text-base font-semibold text-[var(--text)]">更新日志</DrawerTitle>
            <DrawerClose
              className="icon-button border-none bg-transparent p-1"
              style={{ borderColor: 'transparent', backgroundColor: 'transparent' }}
            >
              <CloseIcon width="20" height="20" />
            </DrawerClose>
          </DrawerHeader>
          {content}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col p-0">
        <DialogHeader className="flex-shrink-0 px-6 pt-6 pb-4 border-b border-[var(--border)]">
          <DialogTitle>更新日志</DialogTitle>
        </DialogHeader>
        {content}
      </DialogContent>
    </Dialog>
  );
}
