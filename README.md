# 王朝模拟器：天命

一款**纯前端、AI 原生**的历史王朝模拟游戏。你扮演一位新登基的皇帝，用**自然语言下诏**（「拨款五十万两赈济西北灾民」），由 AI 推演政令在财政、民生、官僚、军队、外交之间的连锁后果。无框架、无构建步骤、无后端——打开即玩。

## 快速开始

| 方式 | 步骤 |
|---|---|
| **零配置体验（推荐）** | 直接双击打开 `index.html`（或 `dist/王朝模拟器-单文件版.html`）→ 点「Demo 演示模式」→ 登基 → 在底部输入框下诏 |
| **接入真实 AI** | 打开 `index.html` → ⚙ 设置 → AI 接口 → 新建配置（OpenAI Compatible）→ 填 Base URL / API Key / 模型名 → 测试连接 → 将「推演 / 对话 / 评语」指向该配置 |

> Demo 模式由内置规则引擎（MockAI）生成与真实 AI **完全同构**的 JSON，无需任何 API Key，用于离线体验与开发调试。

## 操作说明

- **下诏**：底部输入框输入自然语言政令，`Ctrl/Cmd + Enter` 或点「颁布诏令」。政令即时结算，不消耗时间。
- **结束回合**：推进一个月；自动结算岁入岁出、粮食四季、灾害演化、民变积蓄、派系/臣工忠诚漂移、外交关系漂移、随机事件。
- **廷议**：朝堂页选 1～3 位大臣「召集廷议」，可「采纳此议」快速草拟圣旨。
- **召见**：人物页点开任意大臣可逐轮对话；每位大臣藏有秘密，派锦衣卫指挥使「密查」有成败两种后果。
- **国策树**：16+ 项可解锁政策（科举/考成/一条鞭/开海禁……），带前置与即时效果。
- **天下图**：8 大区域 × 8 种数据图层（标准/民心/税入/粮储/灾害/动荡/军力/治安）SVG 地图。
- **实录**：《国史实录》按年检索/筛选/翻页，记录每一道诏书与事件。
- **终局**：10 种结局（盛世/中兴/禅让/崩亡/割据/衰微/黩武/经济崩溃/改革成功/苟延残喘）＋七维评分＋史官评语。

## 存档系统

- 槽位：`auto`（每回合自动）+ `slot1~5` 手动槽，浏览器 localStorage 持久化。
- 格式：JSON，含 `schemaVersion`（当前 1）、djb2 校验和（篡改检测，仅警告不阻断）、元信息。
- 支持**导出为文件 / 从文件导入**；设置与 AI 配置亦可独立导出（**不含 API Key**）。

## 自定义 API

- **OpenAI Compatible**：填 `Base URL`（如 `https://api.deepseek.com/v1`）+ 路径（默认 `/chat/completions`）+ Model + API Key。兼容 OpenAI / DeepSeek / Moonshot / 通义千问等任何兼容端点。
- **完全自定义**：可选 POST/PUT/GET 方法 + Body 模板（占位符 `{{messages_json}}` `{{system}}` `{{user}}` `{{temperature}}` `{{max_tokens}}`）+ `responsePath`（如 `data.content`）。适配任意私有网关。
- **代理模式**：填「代理 URL」后所有请求改发你的中转服务（Key 只存在代理侧，更安全）。
- ⚠ 浏览器直连时 API Key 会出现在网络请求中，且目标服务必须允许跨域（CORS）；本地 file:// 打开时建议使用代理或 Demo 模式。

## 项目结构

```
├── index.html            入口骨架
├── css/style.css         三主题 · 四档响应式 · 无障碍
├── js/
│   ├── utils.js          工具（el 安全DOM/种子RNG/格式化）
│   ├── i18n.js           zh-CN 全量 + zh-TW/en 覆盖
│   ├── data.js           静态数据（地区/人物/派系/国策/事件模板/Prompt默认值/结局）
│   ├── state.js          中央状态 · 唯一变更入口 applyChanges · 月度推演引擎
│   ├── mockai.js         本地 Demo 引擎（意图识别→同构JSON）
│   ├── ai.js             Provider 抽象（OpenAI兼容/自定义/Mock）· Prompt分层 · JSON修复
│   ├── storage.js        localStorage 存档/设置/剧本库
│   ├── map.js            SVG 地图 8 图层
│   ├── ui.js             布局/顶栏/弹窗/toast/composer
│   ├── views.js          九大视图
│   ├── game.js           游戏编排（下诏→推演→验证→应用）
│   └── app.js            启动引导
├── test/                 冒烟测试 + jsdom 全流程 DOM 测试 + 单文件构建脚本
└── dist/王朝模拟器-单文件版.html   全部内联的单文件发行版
```

## 开发

```bash
node test/smoke.js          # 无头逻辑测试（创建→政令×6→钳制→36回合→存档→结局）
node test/dom-boot.js       # jsdom 真实 DOM 全流程测试（欢迎页→登基→下诏→廷议→召见→存档→设置）
node test/build-standalone.js  # 重新生成单文件版
```

## 安全与隐私

- 所有动态内容经安全 DOM 创建渲染，杜绝 XSS；API Key 仅存本机 localStorage，界面与日志一律脱敏显示。
- 无任何遥测、无第三方依赖、可完全离线运行。
