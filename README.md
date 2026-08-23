# XinBan 个人资产行情看板

一个面向个人使用的综合看板，统一管理四类资产与持续性订阅支出：

- 基金
- 股票
- 银行积存金
- CS2 饰品
- 个人订阅

**本项目是基于“基估宝”进行的二次开发版本。** 在保留原基金看板能力的基础上，现已形成基金、股票、银行积存金、CS2 与个人订阅五个独立入口。

> 本项目只用于个人资产记录和行情参考，不构成投资建议。基金、股票、黄金与饰品估值均可能因数据延迟、汇率、手续费和平台流动性产生偏差。

## 一、当前功能

### 1. 基金

- 基金代码/名称搜索与添加
- 实时估值、单位净值、日涨跌与持仓收益
- 基金分组、自选、交易记录、定投与持仓成本
- PC 和移动端双布局
- 基金估值涨幅、跌幅、成交热度、实际涨幅排行
- 基金详情、持仓结构、净值/业绩/估值走势
- Supabase 云同步和多设备恢复
- 工作日历史估值自动采集

基金行情页保持基金专属榜单，不再混入股票行业板块。

### 2. 股票

- 独立股票首页与独立股票行情页
- 支持 A 股、港股和美股代码录入
- 股票分组、持仓、交易和分红记录
- 股票分时与日 K 行情
- 行情页顶部股票搜索/添加入口
- 大盘指数和自选股票行情快照
- “大板块强弱”已从基金行情迁移到股票行情

常见代码形式：

- A 股：`600036`
- 港股：`00700`
- 美股：`AAPL`

### 3. 银行积存金

- 独立黄金首页与黄金行情页
- 记录银行、产品名称、持有克重和总成本
- 手动银行卖出价优先，未填写时使用 Au99.99 公开行情作为参考
- 展示持仓市值、平均成本和持有盈亏
- 黄金资产纳入统一资产概览
- 持仓支持本地保存、云同步和导入导出

### 4. CS2 饰品

- 根据公开 SteamID64 同步 Steam 库存
- 展示饰品图片、磨损、模板、可交易状态等信息
- 通过 SteamDT 获取 Steam、BUFF、悠悠有品、C5GAME 等平台报价
- 按最低在售价估算库存总值
- 独立 CS2 行情页，不设置无意义的顶部搜索框
- SteamDT 大盘指数、昨日变化和近期走势
- 库存数量、已覆盖报价数量和高市值饰品排行
- 直达 SteamDT 市场总览、饰品市场和板块指数
- Cloudflare Cache + KV 缓存，降低 Steam 和 SteamDT 请求频率

CS2 云端服务默认只允许一个配置好的 SteamID64 使用，以保护 SteamDT 配额。

### 5. 个人订阅

- 记录服务名称、分类、价格、币种、扣费周期与下次续费日期
- 支持 CNY、USD、HKD，外币自动折算人民币
- 展示月均、日均、年化支出与 30 天内续费数量
- 支持使用中、试用中、暂停、取消状态
- 订阅记录支持本地保存、导入导出和 Supabase 云同步
- 汇率按日更新并保留设备本地缓存，可为单条订阅设置手动汇率
- 独立订阅行情页，支持按分类、币种和关键词查询会员价格
- 公共价格表保存在 `public/data/subscription-prices.md`，网页优先读取 GitHub `main` 分支，失败时回退到随网站发布的副本

## 二、页面结构

```text
资产类型
├─ 基金
│  ├─ 首页：持仓、收益、分组、基金操作
│  └─ 行情：基金估值与涨跌榜单
├─ 股票
│  ├─ 首页：股票持仓、交易、分红和图表
│  └─ 行情：股票搜索、大盘指数、大板块强弱、自选快照
├─ 黄金
│  ├─ 首页：银行积存金持仓、成本、市值与盈亏
│  └─ 行情：Au99.99 参考行情和持仓估值
├─ CS2
│  ├─ 首页：Steam 库存、报价和饰品明细
│  └─ 行情：SteamDT 大盘、走势、库存估值和高市值饰品
└─ 订阅
   ├─ 首页：持续性支出、汇率换算、续费日期和订阅明细
   └─ 行情：会员价格、分类/币种筛选和官方购买入口
```

行情分流入口是 `app/components/AssetMarketTab.jsx`：

- 基金：`app/components/MarketTab.jsx`
- 股票：`app/components/StockMarketTab.jsx`
- 黄金：`app/components/BankGoldDashboard.jsx`
- CS2：`app/components/Cs2MarketTab.jsx`
- 订阅：`app/components/SubscriptionMarketTab.jsx`

## 三、技术架构

```mermaid
flowchart LR
    U[浏览器] --> W[Cloudflare Worker]
    W --> A[静态 Next.js 页面]
    U <--> S[Supabase Auth / Database]
    U --> E[东方财富 / 天天基金]
    U --> T[腾讯财经]
    U --> N[新浪财经]
    U --> C[/api/cs2]
    C --> SI[Steam 公开库存]
    C --> SD[SteamDT 开放接口]
    C <--> KV[Cloudflare KV / Cache]
    CR[Supabase pg_cron] --> EF[基金估值采集函数]
    EF --> E
    EF --> N
    EF --> S
```

主要技术：

- Next.js 16 App Router
- React 18
- JavaScript / JSX
- Zustand + 浏览器本地存储
- TanStack Query / Table / Virtual
- Chart.js
- Supabase Auth、PostgreSQL、Edge Functions、pg_cron
- Cloudflare Workers、Static Assets、KV
- Steam 与 SteamDT API

项目使用静态导出，`npm run build` 会生成 `out/`，Cloudflare Worker 同时负责静态资源和 `/api/cs2/*` 服务端接口。

## 四、数据来源

| 资产          | 主要来源                     | 用途                                 |
| ------------- | ---------------------------- | ------------------------------------ |
| 基金          | 东方财富、天天基金、新浪财经 | 基本信息、持仓、净值、估值与排行     |
| 股票          | 腾讯财经、东方财富           | 股票报价、指数、分时、K 线与行业板块 |
| CS2 库存      | Steam Community 公开库存     | 饰品清单、图片和公开属性             |
| CS2 价格/大盘 | SteamDT 开放平台             | 多平台报价、大盘指数与走势           |
| 订阅会员价格  | 仓库公开 Markdown 价格表     | 会员价格、币种、更新时间和购买入口   |
| 交易日        | `chinese-days` + jsDelivr    | 中国交易日和节假日判断               |

这些公开接口可能调整、限流或暂时不返回某一资产数据。单项数据缺失不一定表示整个项目故障。

## 五、数据保存

### 浏览器本地

本地数据统一通过 `app/stores/storageStore.js` 管理，主要包括：

- 基金、基金分组和交易数据
- 股票、股票分组、交易与分红数据
- CS2 库存和最近报价
- 个人订阅记录与续费信息
- 自选、布局、主题及其他设置

不要在业务代码中绕过 `storageStore` 直接操作 `window.localStorage`。

### Supabase 云端

用户登录后，本地配置可同步到 Supabase，支持跨设备恢复。基金估值历史另外保存在：

- 表：`fund_valuation_history`
- 采集函数：`collect-fund-valuations`
- 查询函数：`get-fund-valuation-trend`
- 排行函数：`fund-valuation-ranking`

当前基金历史采集任务在每周一至周五北京时间 15:10 执行。配置模板位于：

`supabase/sql/configure_fund_valuation_cron.sql`

## 六、目录说明

```text
XinBan/
├─ app/
│  ├─ page.jsx                    主页面、四类资产与订阅入口
│  ├─ api/
│  │  ├─ fund.js                 基金和部分市场数据
│  │  ├─ stock.js                股票数据
│  │  └─ cs2.js                  CS2 前端数据客户端
│  ├─ components/                基金、股票、黄金、CS2、订阅页面和组件
│  ├─ stores/                    Zustand 与统一存储层
│  └─ lib/                       Supabase、交易日、查询等工具
├─ components/ui/                UI 基础组件
├─ public/                       PWA、图标、基金搜索数据
├─ scripts/
│  ├─ dev-local.mjs              同时启动 Next.js 与 CS2 本地代理
│  └─ cs2-proxy.mjs              本地 CS2 服务端代理
├─ worker/index.js               Cloudflare Worker /api/cs2
├─ supabase/
│  ├─ functions/                 云端基金函数
│  ├─ migrations/                数据库迁移
│  └─ sql/                       Cron 配置和测试 SQL
├─ doc/                          数据结构与数据库说明
├─ wrangler.jsonc                Cloudflare 部署配置
├─ env.example                   环境变量模板
└─ package.json                  命令与依赖
```

## 七、本地运行

### 1. 安装环境

- Node.js 20.9 或更高版本
- npm

### 2. 安装依赖

```bash
npm ci
```

### 3. 创建环境变量

复制 `env.example` 为 `.env.local`，再填写实际配置。不要提交 `.env.local`。

核心配置：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

STEAMDT_API_KEY=
CS2_ALLOWED_STEAM_ID=
NEXT_PUBLIC_CS2_PROXY_URL=
CS2_PROXY_PORT=31777
CS2_ALLOWED_ORIGINS=
```

说明：

- `STEAMDT_API_KEY` 只能保存在本机或 Cloudflare Secret，不能添加 `NEXT_PUBLIC_` 前缀。
- `CS2_ALLOWED_STEAM_ID` 是允许调用报价服务的 17 位 SteamID64。
- 本地开发通常让 `NEXT_PUBLIC_CS2_PROXY_URL` 留空，前端会自动连接 `127.0.0.1:31777`。

### 4. 启动完整本地环境

```bash
npm run dev
```

默认地址：

- 看板：<http://localhost:31888/>
- CS2 本地代理：<http://127.0.0.1:31777/>

其他命令：

```bash
npm run dev:next   # 只启动 Next.js
npm run cs2:proxy  # 只启动 CS2 本地代理
npm run lint       # 代码检查
npm run build      # 生产构建
```

## 八、Cloudflare 部署

`wrangler.jsonc` 当前配置包括：

- 静态资源目录：`out/`
- Worker 入口：`worker/index.js`
- 服务端路由：`/api/cs2/*`
- KV 绑定：`CS2_CACHE`
- 必需 Secrets：`STEAMDT_API_KEY`、`CS2_ALLOWED_STEAM_ID`

首次使用新的 Cloudflare 账号时，应创建自己的 KV 命名空间，并把 `wrangler.jsonc` 中的 KV ID 替换为新 ID。

部署前设置密钥：

```bash
npx wrangler secret put STEAMDT_API_KEY
npx wrangler secret put CS2_ALLOWED_STEAM_ID
```

构建并部署：

```bash
npm run build
npx wrangler deploy
```

当前已上线的旧入口为：

<https://real-time-fund.real-time-fund.workers.dev/>

`XinBan` 是本次整理出的独立新版源码副本，在单独执行部署前不会自动替换线上版本。

## 九、Supabase 配置

前端至少需要：

```dotenv
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

数据库和函数源码已整理在 `supabase/`。迁移到新的 Supabase 项目时需要重新执行：

1. `doc/supabase.sql` 中的基础表结构。
2. `supabase/migrations/` 中的后续迁移。
3. 部署 `supabase/functions/` 下的 Edge Functions。
4. 创建采集密钥和 Vault Secret。
5. 执行 `supabase/sql/configure_fund_valuation_cron.sql`，并替换项目地址及密钥占位符。
6. 在 Auth 中配置站点地址、Redirect URL、六位邮箱验证码和 SMTP。

不要把 `service_role`、数据库密码、SMTP 密码或 Cron Secret 写进前端环境变量。

## 十、安全要求

禁止提交或公开：

- `.env.local`
- SteamDT API Key
- Cloudflare API Token
- Supabase `service_role` Key
- Supabase 数据库密码
- Resend / SMTP 密码
- Gmail 应用专用密码
- 登录验证码
- `COLLECTOR_CRON_SECRET`

Supabase Anon / Publishable Key 可以出现在前端，但数据库必须配置正确的 RLS 策略。

Steam 库存必须为公开状态才能读取。项目只读取公开库存，不应保存 Steam 密码、Cookie 或登录令牌。

## 十一、已完成验证

基金、股票和 CS2 行情分流已经完成以下验证：

- 基金、股票、CS2 行情页分别渲染不同内容
- 股票行情顶部搜索可用
- 大板块强弱位于股票行情页
- CS2 行情没有顶部搜索框
- SteamDT 大盘指数和走势能够返回
- CS2 库存估值及高市值饰品能够展示
- 桌面端和移动端布局检查通过
- 移动端股票输入框字号为 16px，避免 iOS Safari 自动缩放
- 生产构建通过
- 本次新增的 CS2、股票行情分流文件通过定向 ESLint 检查

黄金资产入口已通过全量 ESLint、生产构建和本地 HTTP 冒烟测试；桌面端、移动端视觉与完整业务回归仍待完成。

## 十二、已知限制

- CS2 估值采用平台在售价，不等于立即可成交价格，也未扣除手续费。
- Steam 库存需要公开；Steam 或 SteamDT 限流时会使用短期缓存或最近一次缓存。
- SteamDT 接口权限和频率取决于账户套餐。
- 部分 QDII 基金没有公开盘中估值，因此历史估值图可能为空。
- 免费 Supabase 项目长期无访问可能暂停，应定期检查。
- 财经公开接口发生字段变化时，需要同步调整解析逻辑。
- 继承代码的全量 ESLint 仍有少量 Prettier 格式错误和 React Hook 警告；本次没有为通过检查而批量改写旧业务代码。
- 当前依赖审计会报告若干间接依赖风险，升级前应逐项验证，不建议直接执行可能引入破坏性升级的全量自动修复。

## 十三、后续建议

CS2 行情页的下一阶段修改已经完成，实施记录见 [`doc/后续修改方向.md`](./doc/后续修改方向.md)：已增加 Steam 官方更新日志通告、高市值饰品 Top 10，并为饰品增加 24h 市场涨跌展示。

1. 把 `XinBan` 建立为自己的独立 Git 仓库，不再直接向上游仓库推送个人配置。
2. 部署到一个新的 Cloudflare Worker 名称，先与旧线上版本并行测试。
3. 新建独立 KV，避免测试版与正式版共用 CS2 缓存。
4. 为股票和 CS2 增加云端历史价格表，再制作收益曲线。
5. 加入每日数据源健康检查，及时发现东方财富、腾讯、Steam 或 SteamDT 接口变化。
6. 定期导出本地资产数据，并备份 Supabase 表结构和函数。

## 十四、来源与许可证

本项目是基于开源项目“基估宝”进行的二次开发：

<https://github.com/hzm0321/real-time-fund>

项目保留原许可证 `LICENSE`。该许可证为 AGPL-3.0，公开部署和分发修改版本时，应遵守其源代码开放义务。
