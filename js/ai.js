/* ============================================================================
 * ai.js — AI 调用架构
 * ----------------------------------------------------------------------------
 * · AIProvider            统一接口：async chat(messages, options) → {text, usage}
 *   ├─ MockProvider       本地 Demo 推演（路由到 DS.Mock）
 *   ├─ OpenAICompatible   POST {base}/chat/completions，解析 choices.0.message.content
 *   └─ CustomProvider     自定义方法/路径/Headers/Body 模板/响应 JSON Path
 * · AIService             中间层：Prompt 构建、上下文分层、超时、重试、
 *                         JSON 提取修复、错误分类、Token 统计、调试记录
 * 规则：游戏逻辑一律调用 DS.aiService.chat*()，禁止散落 fetch()。
 * ==========================================================================*/
(function (DS) {
  'use strict';

  /* ============================ 错误类型 ============================ */
  class AIError extends Error {
    constructor(message, opts = {}) {
      super(message);
      this.name = 'AIError';
      this.httpStatus = opts.httpStatus || 0;
      this.kind = opts.kind || 'unknown'; // network|http|timeout|parse|cancel|config
      this.suggestion = opts.suggestion || '';
      this.bodySnippet = opts.bodySnippet || '';
    }
  }

  /** HTTP 状态码 → 用户能看懂的解释与建议 */
  function describeStatus(status) {
    const M = {
      401: ['API Key 无效或未填写', '检查 API Key 是否正确、是否已过期。'],
      403: ['没有访问权限', '确认账户有该模型权限，或 Key 作用域/地域限制。'],
      404: ['接口路径或模型不存在', '检查 Base URL 是否以 /v1 等版本号结尾、模型名称是否拼写正确。'],
      429: ['请求频率过高或额度不足', '降低请求频率，或检查 API 余额/配额。'],
      500: ['服务端内部错误', '稍后重试；若持续失败，换用其他模型或服务商。'],
      502: ['网关错误', '上游服务暂不可用，请稍后重试。'],
      503: ['服务过载或维护中', '稍后重试，或更换模型。'],
    };
    return M[status] || ['服务返回错误', '查看下方响应正文了解详情。'];
  }

  /* ============================ JSON 提取与修复 ============================ */
  /** 从模型输出中尽力提取 JSON 对象；失败返回 null */
  function extractJSON(text) {
    if (!text) return null;
    let s = String(text).trim();
    // 1) 去掉 ```json ... ``` 包裹
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fence) s = fence[1].trim();
    // 2) 直接解析
    try { return JSON.parse(s); } catch (_e) { /* 继续修复 */ }
    // 3) 截取第一个 { 到最后一个 } 之间
    const a = s.indexOf('{');
    const b = s.lastIndexOf('}');
    if (a >= 0 && b > a) {
      let core = s.slice(a, b + 1);
      try { return JSON.parse(core); } catch (_e) { /* 继续修复 */ }
      // 4) 常见问题修复：全角标点、尾逗号、智能引号（\u201C\u201D=弯双引号，\u2018\u2019=弯单引号）
      core = core
        .replace(/[\u201C\u201D]/g, '"').replace(/[\u2018\u2019]/g, "'")
        .replace(/，/g, ',').replace(/：/g, ':')
        .replace(/,\s*([}\]])/g, '$1');
      try { return JSON.parse(core); } catch (_e) { /* 放弃 */ }
    }
    return null;
  }

  /* ============================ Provider 基类 ============================ */
  class AIProvider {
    async chat(_messages, _options) { throw new Error('not implemented'); }
  }

  /* ---------------- OpenAI Compatible ---------------- */
  class OpenAICompatibleProvider extends AIProvider {
    constructor(profile) { super(); this.profile = profile || {}; }

    buildUrl() {
      const p = this.profile;
      // 代理优先（模式 B）；否则 Base URL + 路径
      const base = (p.proxyUrl || p.baseUrl || '').replace(/\/+$/, '');
      const path = p.path || '/chat/completions';
      return /^https?:\/\//i.test(path) ? path : base + path;
    }

    buildInit(messages, options) {
      const p = this.profile;
      const headers = { 'Content-Type': 'application/json' };
      if (p.apiKey) headers['Authorization'] = `Bearer ${p.apiKey}`;
      if (p.headers) for (const [k, v] of Object.entries(p.headers)) if (k && v) headers[k] = v;
      const body = {
        model: p.model || '',
        messages,
        temperature: numOr(options.temperature, numOr(p.temperature, 0.7)),
        max_tokens: numOr(options.maxTokens, numOr(p.maxTokens, 4000)),
      };
      if (p.topP != null && p.topP !== '') body.top_p = Number(p.topP);
      return { url: this.buildUrl(), init: { method: 'POST', headers, body: JSON.stringify(body) } };
    }

    /**
     * 从响应 JSON 取文本。
     * 推理模型（如 deepseek-reasoner / deepseek-v4-flash）把思考过程放在
     * `reasoning_content`、最终答案放在 `content`。当 token 预算不足时
     * `content` 可能为空而 `reasoning_content` 有内容（思考被截断）。
     * 本方法在主路径取空时自动回退到 reasoning_content，并附带诊断信息。
     * 返回 { text, finishReason, fromReasoning }
     */
    pickContentEx(data) {
      const path = this.profile.responsePath || 'choices.0.message.content';
      const val = getPath(data, path);
      const content = typeof val === 'string' ? val : (val == null ? '' : JSON.stringify(val));
      // finish_reason 可在 choices[0].finish_reason 或顶层
      const finishReason = getPath(data, 'choices.0.finish_reason') || getPath(data, 'finish_reason') || '';
      // 推理模型回退：content 为空时尝试 reasoning_content
      if (!content) {
        const rc = getPath(data, 'choices.0.message.reasoning_content')
          || getPath(data, 'reasoning_content') || '';
        if (typeof rc === 'string' && rc.trim()) {
          return { text: rc.trim(), finishReason, fromReasoning: true };
        }
      }
      return { text: content, finishReason, fromReasoning: false };
    }

    pickContent(data) {
      const path = this.profile.responsePath || 'choices.0.message.content';
      const val = getPath(data, path);
      return typeof val === 'string' ? val : (val == null ? '' : JSON.stringify(val));
    }

    async chat(messages, options) {
      const { url, init } = this.buildInit(messages, options);
      const res = await fetchWithTimeout(url, init, numOr(options.timeoutMs, 60000), options.signal);
      const data = await readJsonBody(res);
      handleHttpErrors(res.status, data);
      const { text: content, finishReason, fromReasoning } = this.pickContentEx(data);
      if (!content) {
        // 区分两种空响应，给出更精准的提示
        if (finishReason === 'length') {
          throw new AIError('模型输出被截断（token 预算耗尽）', {
            kind: 'parse',
            suggestion: `finish_reason=length 表示 max_tokens 不够。推理模型（如 deepseek-reasoner）会先在 reasoning_content 思考、再把答案写入 content；预算不足时思考刚写完答案还没生成。请在设置中调大该配置的「最大 Token」（建议 ≥4000，推演用途建议 ≥8000）。`,
            bodySnippet: DS.util.trunc(JSON.stringify(data), 400),
          });
        }
        throw new AIError('API 返回了空内容', {
          kind: 'parse',
          suggestion: `当前 Response Path 为「${this.profile.responsePath || 'choices.0.message.content'}」取到空字符串。若使用推理模型，content 为空可能因 token 不足（finish_reason=length）或模型未输出答案。请核对路径或调大 max_tokens。`,
          bodySnippet: DS.util.trunc(JSON.stringify(data), 400),
        });
      }
      // 若实际内容来自 reasoning_content（推理模型回退），记录但不阻断
      return { text: content, usage: data.usage || null, fromReasoning, finishReason };
    }
  }

  /* ---------------- Custom（自定义请求模板） ---------------- */
  class CustomProvider extends OpenAICompatibleProvider {
    buildInit(messages, options) {
      const p = this.profile;
      const base = (p.proxyUrl || p.baseUrl || '').replace(/\/+$/, '');
      const path = p.path || '/chat/completions';
      const url = /^https?:\/\//i.test(path) ? path : base + path;

      const headers = { 'Content-Type': 'application/json' };
      if (p.apiKey && !(p.headers && Object.keys(p.headers).some((k) => /authorization/i.test(k)))) {
        headers['Authorization'] = `Bearer ${p.apiKey}`;
      }
      if (p.headers) for (const [k, v] of Object.entries(p.headers)) if (k && v) headers[k] = v;

      const system = messages.find((m) => m.role === 'system');
      const userParts = messages.filter((m) => m.role !== 'system');
      const tpl = p.bodyTemplate && p.bodyTemplate.trim()
        ? p.bodyTemplate
        : JSON.stringify({ model: '{{model}}', messages: '{{messages_json}}', temperature: '{{temperature}}', max_tokens: '{{max_tokens}}' });
      const filled = tpl
        .replaceAll('{{model}}', p.model || '')
        .replaceAll('{{messages_json}}', JSON.stringify(messages))
        .replaceAll('{{system}}', system ? system.content : '')
        .replaceAll('{{user}}', userParts.map((m) => m.content).join('\n\n'))
        .replaceAll('{{temperature}}', String(numOr(options.temperature, numOr(p.temperature, 0.7))))
        .replaceAll('{{max_tokens}}', String(numOr(options.maxTokens, numOr(p.maxTokens, 4000))));
      let bodyStr = filled;
      try { bodyStr = JSON.stringify(JSON.parse(filled)); } catch (_e) { /* 模板非合法 JSON 时原样发送 */ }

      return { url, init: { method: p.method || 'POST', headers, body: bodyStr } };
    }
  }

  /* ---------------- Mock ---------------- */
  class MockProvider extends AIProvider {
    async chat(_messages, options) {
      // 模拟网络延迟，让 Loading 动画有意义（300~900ms）
      await new Promise((r) => setTimeout(r, 300 + Math.random() * 600));
      const state = options.mockState;
      const kind = options.mockKind;
      if (!state) throw new AIError('Demo 模式缺少世界状态', { kind: 'config' });
      if (kind === 'order') {
        return { text: JSON.stringify(DS.Mock.simulateOrder(state, options.mockPayload.text)), usage: null };
      }
      if (kind === 'council') {
        return { text: JSON.stringify(DS.Mock.runCouncil(state, options.mockPayload.charIds)), usage: null };
      }
      if (kind === 'dialogue') {
        return { text: JSON.stringify(DS.Mock.dialogue(state, options.mockPayload.charId, options.mockPayload.message)), usage: null };
      }
      if (kind === 'verdict') {
        return { text: DS.Mock.verdict(state, options.mockPayload.ending), usage: null };
      }
      if (kind === 'test') {
        return { text: 'API连接成功（本地 Demo 推演模式）', usage: null };
      }
      throw new AIError(`未知的 Demo 推演类型 ${kind}`, { kind: 'config' });
    }
  }

  /* ============================ 底层工具 ============================ */
  function numOr(v, dflt) { const n = Number(v); return isFinite(n) ? n : dflt; }

  /** 点路径取值：choices.0.message.content */
  function getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  }

  /** 带超时与外部取消的 fetch */
  async function fetchWithTimeout(url, init, timeoutMs, externalSignal) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new DOMException('timeout', 'TimeoutError')), timeoutMs);
    const onExternalAbort = () => ctrl.abort(new DOMException('cancelled', 'AbortError'));
    if (externalSignal) {
      if (externalSignal.aborted) onExternalAbort();
      else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
    }
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      if (err && err.name === 'TimeoutError') {
        throw new AIError(`请求超时（${timeoutMs} ms）`, { kind: 'timeout', suggestion: '可在设置的 Token 控制中调大超时时间，或更换更快的模型。' });
      }
      if (err && err.name === 'AbortError') {
        throw new AIError('请求已取消', { kind: 'cancel', suggestion: '' });
      }
      throw new AIError(`网络请求失败：${err && err.message ? err.message : err}`, {
        kind: 'network',
        suggestion: '可能原因：断网、Base URL 错误，或该 API 不允许浏览器跨域（CORS）。请使用支持 CORS 的 API，或在「代理 URL」中填写你自己的后端代理。',
      });
    } finally {
      clearTimeout(timer);
      if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
    }
  }

  async function readJsonBody(res) {
    const raw = await res.text().catch(() => '');
    try { return raw ? JSON.parse(raw) : {}; }
    catch (_e) {
      const e = new AIError('API 返回的不是 JSON', {
        kind: 'parse', httpStatus: res.status,
        bodySnippet: DS.util.trunc(raw, 400),
        suggestion: '确认 Base URL/路径指向的是 Chat Completions 接口，而不是网页。',
      });
      throw e;
    }
  }

  function handleHttpErrors(status, data) {
    if (status >= 200 && status < 300) return;
    const [reason, advice] = describeStatus(status);
    const msg = data && data.error && data.error.message ? String(data.error.message) : reason;
    throw new AIError(`HTTP ${status}：${msg}`, {
      kind: 'http', httpStatus: status,
      suggestion: `${reason}。建议：${advice}`,
      bodySnippet: DS.util.trunc(JSON.stringify(data), 400),
    });
  }

  /* ============================ Prompt Builder（上下文分层） ============================ */
  const PB = {

    /** Layer1 世界基础 + Layer2 当前回合 */
    worldCore(state) {
      const C = state.country;
      const diff = DS.DATA.DIFFICULTIES.find((d) => d.id === state.difficulty) || {};
      return [
        `【L1 世界基础】王朝：${state.dynasty.countryName}｜年号${state.ruler.eraName}｜皇帝${state.ruler.name}｜难度：${diff.label || state.difficulty}(惯性${diff.inertia})`,
        `皇权 ${Math.round(state.ruler.authority)}｜正统 ${state.ruler.legitimacy}`,
        `国库 ${Math.round(C.treasury)}两｜国债 ${Math.round(C.debt)}｜粮食 ${Math.round(C.food)}石｜人口 ${C.population}`,
        `民心 ${Math.round(C.publicSupport)}｜稳定 ${Math.round(C.stability)}｜腐败 ${Math.round(C.corruption)}｜官僚 ${Math.round(C.bureaucracy)}｜军力 ${Math.round(C.militaryPower)}｜士气 ${Math.round(C.morale)}｜边压 ${Math.round(C.borderPressure)}`,
        `已推行国策：${(state.activePolicies || []).map((id) => (state.policiesKnown.find((p) => p.id === id) || {}).name).filter(Boolean).join('、') || '无'}`,
        `【L2 当前回合】第 ${state.turn} 回合｜${DS.util.dateLabel(state.date)}（${DS.util.seasonOf(state.date.month)}季）`,
        `各地灾情：${state.regions.filter((r) => r.disaster).map((r) => `${r.name}${r.disaster.type}${DS.DATA.SEVERITY_LABELS[r.disaster.severity]}`).join('、') || '无'}`,
        `待触发隐患：${(state.pendingEvents || []).map((p) => `${p.title}(第${p.dueTurn}回合)`).join('、') || '无'}`,
      ].join('\n');
    },

    /** Layer3 近期事件 + Layer5 长期记忆 */
    memoryBlock(state) {
      const recent = (state.events || []).slice(0, 6)
        .map((e) => `- [${e.date}/${e.severity}] ${e.title}：${DS.util.trunc(e.description, 60)}`).join('\n');
      const mem = (state.longTermMemory || []).slice(0, 8).map((m) => `- ${m}`).join('\n');
      return `【L3 近期事件】\n${recent || '（无）'}\n【L5 长期记忆】\n${mem || '（无）'}`;
    },

    /** Layer4 重要人物 */
    npcBlock(state) {
      const chars = [...(state.characters || [])]
        .sort((a, b) => b.ability * b.ambition - a.ability * a.ambition).slice(0, 8);
      const lines = chars.map((c) =>
        `- ${c.id} ${c.name}（${c.role}，${c.faction}）忠${Math.round(c.loyalty)} 能${c.ability} 贪${c.corruption} 信${Math.round(c.trust)}｜性格:${c.personality.join('/')}｜近况:${c.task}`);
      const regions = state.regions.map((r) =>
        `- ${r.id} ${r.name}：民${Math.round(r.loyalty)} 乱险${Math.round(r.unrest)} 税率${r.taxRate}% 粮${DS.util.fmtRes(r.grain, '石')} 治安${Math.round(r.security)}${r.disaster ? `（${r.disaster.type}${r.disaster.severity}级）` : ''}`);
      const diplo = (state.diplomacy || []).map((d) =>
        `- ${d.id} ${d.name}（${d.type}）：关系${d.relation} 边压${d.borderPressure} 威胁${d.threat} 贸易${d.trade}`);
      return `【L4 重要人物】\n${lines.join('\n')}\n【地区速览】\n${regions.join('\n')}\n【外交】\n${diplo.join('\n')}`;
    },

    /** 完整推演 Prompt：Layer6 玩家命令收尾 */
    simulation(state, orderText) {
      const prompts = getPrompts();
      const system = prompts.system + '\n\n' + prompts.worldview + '\n\n' + prompts.event + '\n\n' + prompts.simulation;
      const user = [
        PB.worldCore(state),
        PB.memoryBlock(state),
        PB.npcBlock(state),
        state.intro ? `【剧本背景】\n${DS.util.trunc(state.intro, 300)}` : '',
        `【L6 皇帝政令】\n"""${orderText}"""`,
        '请按系统提示中的 JSON 结构输出本回合推演结果，只输出 JSON。',
      ].filter(Boolean).join('\n\n');
      return { system, user };
    },

    council(state, charIds) {
      const prompts = getPrompts();
      const chars = charIds.map((id) => DS.State.getCharacter(state, id)).filter(Boolean);
      const persona = chars.map((c) =>
        `- ${c.id} ${c.name}｜${c.role}｜派系:${c.faction}｜忠诚${Math.round(c.loyalty)}｜能力${c.ability}｜性格:${c.personality.join('/')}${c.secrets.length && (state.flags.revealedSecrets || []).includes(c.id) ? '｜(皇帝已知其秘密:' + c.secrets[0] + ')' : ''}`).join('\n');
      const system = prompts.system + '\n\n【廷议任务】\n诸位大臣奉召廷议。为每位大臣生成一段发言：\n- 发言必须体现其职位关注点、性格与派系利益，绝不允许两人说同样的话。\n- 可引用上方具体数值佐证观点；可互相呼应或反驳（在 content 中点名对方）。\n- support 字段：support=赞同现状方向 / cautious=有保留 / oppose=反对。\n- 只输出 JSON：{"speeches":[{"characterId":"ID","stance":"二字态度","support":"support|cautious|oppose","content":"80~160字发言"}],"consensus":"四字概括","advice_summary":"一句话归纳分歧"}';
      const user = [
        PB.worldCore(state),
        PB.memoryBlock(state),
        `【参会大臣】\n${persona}`,
        '请生成廷议发言 JSON。',
      ].join('\n\n');
      return { system, user };
    },

    dialogue(state, charId, message, history) {
      const prompts = getPrompts();
      const c = DS.State.getCharacter(state, charId);
      const relations = Object.entries(c.relationships || {}).map(([oid, r]) => {
        const o = DS.State.getCharacter(state, oid);
        return o ? `${o.name}(${r.type})` : null;
      }).filter(Boolean).join('、');
      // 秘密保护：只有 flags.revealedSecrets 里的人物才把秘密给模型
      const secretNote = c.secrets.length
        ? ((state.flags.revealedSecrets || []).includes(c.id)
          ? `(该秘密已被皇帝察觉，可坦然谈及:${c.secrets.join('；')})`
          : '(以下秘密绝对不能在对话中提及或暗示:' + c.secrets.join('；') + ')')
        : '';
      const system = prompts.system + '\n\n' + prompts.npc +
        `\n\n【你所扮演的角色】\n${c.name}，${c.role}，${c.faction}，年龄${c.age}。性格：${c.personality.join('/')}。忠诚${Math.round(c.loyalty)}，能力${c.ability}，野心${c.ambition}，贪腐${c.corruption}。当前事务：${c.task}。${relations ? '人物关系：' + relations + '。' : ''}${secretNote}`;
      const user = [
        PB.worldCore(state),
        `【近期大事】\n${(state.events || []).slice(0, 3).map((e) => `- ${e.title}`).join('\n') || '（无）'}`,
        history && history.length ? `【此前君臣对话摘要】\n${history.slice(-3).join('\n')}` : '',
        `【陛下问】\n"""${message}"""`,
        '只输出 JSON：{"reply":"...","attitude":"...","trust_delta":整数}',
      ].filter(Boolean).join('\n\n');
      return { system, user };
    },

    summary(state, ending) {
      const prompts = getPrompts();
      const system = prompts.summary;
      const bigEvents = (state.history || []).slice(0, 20).map((h) => `[${h.date}] ${h.title}`).join('\n');
      const user = [
        PB.worldCore(state),
        `结局：${ending.label}——${ending.desc}`,
        `评分：经济${scoresOf(ending, 'economy')} 民生${scoresOf(ending, 'livelihood')} 军事${scoresOf(ending, 'military')} 政治${scoresOf(ending, 'political')} 外交${scoresOf(ending, 'diplomatic')} 改革${scoresOf(ending, 'reform')} 稳定${scoresOf(ending, 'stabilityScore')}`,
        `在位 ${ending.stats.reignYears} 年（${ending.stats.turns} 回合），下诏 ${ending.stats.orders} 道，推行国策 ${ending.stats.policies} 项。`,
        `【大事记节选】\n${bigEvents}`,
        '请撰写史官评语。',
      ].join('\n');
      return { system, user };
    },
  };
  function scoresOf(e, k) { return e.scores && e.scores[k] != null ? Math.round(e.scores[k]) : '—'; }
  function getPrompts() {
    const s = DS.Storage ? DS.Storage.loadSettings() : null;
    return (s && s.prompts) || DS.DATA.DEFAULT_PROMPTS;
  }

  /* ============================ AIService ============================ */
  class AIService {
    constructor() {
      this.debug = { lastPrompt: null, lastResponse: null, latencyMs: 0, usage: null, parseStatus: '', requestUrl: '' };
    }

    settings() { return DS.Storage.loadSettings(); }

    /** 按用途解析 Profile；找不到或显式为 mock 时返回 MockProvider */
    providerFor(purpose) {
      const st = this.settings();
      const pid = st.api.purposes[purpose];
      const prof = (st.api.profiles || []).find((p) => p.id === pid);
      if (!prof || prof.kind === 'mock') return new MockProvider();
      if (prof.kind === 'custom') return new CustomProvider(prof);
      return new OpenAICompatibleProvider(prof);
    }

    isActiveMock(purpose) {
      const st = this.settings();
      const pid = st.api.purposes[purpose];
      const prof = (st.api.profiles || []).find((p) => p.id === pid);
      return !prof || prof.kind === 'mock';
    }

    /** 文本对话（NPC 台词等需要 JSON 的场景请用 chatJSON） */
    async chatRaw(purpose, system, user, opts = {}) {
      const st = this.settings();
      const prof = (st.api.profiles || []).find((p) => p.id === st.api.purposes[purpose]);
      const provider = this.providerFor(purpose);
      const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
      const options = {
        temperature: opts.temperature ?? prof?.temperature,
        maxTokens: opts.maxTokens ?? prof?.maxTokens,
        timeoutMs: opts.timeoutMs ?? prof?.timeoutMs ?? st.ai.timeoutMs,
        signal: opts.signal,
        mockKind: opts.mockKind, mockState: opts.mockState, mockPayload: opts.mockPayload,
      };
      this.debug.lastPrompt = { purpose, system, user, at: DS.util.nowISO() };
      const t0 = performance.now();
      const out = await provider.chat(messages, options);
      this.debug.latencyMs = Math.round(performance.now() - t0);
      this.debug.usage = out.usage;
      this.debug.lastResponse = DS.util.maskSecret(out.text, prof && prof.apiKey);
      this.debug.requestUrl = provider.buildUrl ? provider.buildUrl() : '(mock)';
      return out;
    }

    /**
     * 要求模型返回 JSON 并解析；失败自动重试一次（附修复指令）。
     * @returns {object} 解析后的对象
     * @throws AIError
     */
    async chatJSON(purpose, system, user, opts = {}) {
      let lastErr = null;
      for (let attempt = 0; attempt <= 1; attempt++) {
        const retryNote = attempt === 0 ? '' :
          '\n\n【重要】上一次输出不是合法 JSON。请重新输出，且只输出一个合法 JSON 对象：不要 Markdown 代码块、不要解释文字、不要尾逗号。';
        const out = await this.chatRaw(purpose, system, user + retryNote, opts);
        const parsed = extractJSON(out.text);
        if (parsed) {
          this.debug.parseStatus = attempt === 0 ? '直接解析成功' : '重试后解析成功';
          return parsed;
        }
        // 推理模型回退场景：content 为空、reasoning_content 有思考但非 JSON 答案
        const reasoningHint = out.fromReasoning
          ? '本次内容来自 reasoning_content（推理模型的思考过程），content 为空说明 token 预算不足、模型还没来得及输出正式 JSON 答案就被截断。请在设置中大幅调大该配置的「最大 Token」（推演建议 ≥8000），或改用非推理模型（如 deepseek-chat）。'
          : '模型返回的内容不含合法 JSON。可尝试：换用指令遵循更好的模型、调低 Temperature，或在设置中修改推演 Prompt。';
        lastErr = new AIError('AI 返回的内容无法解析为 JSON', {
          kind: 'parse',
          suggestion: '已在后台自动重试仍失败。' + reasoningHint,
          bodySnippet: DS.util.trunc(out.text, 400),
        });
        this.debug.parseStatus = attempt === 0 ? '首次解析失败，重试中…' : '解析失败';
      }
      throw lastErr;
    }

    /** 测试某个 Profile 连通性 */
    async testProfile(profileId) {
      const t0 = performance.now();
      const st = this.settings();
      const idx = (st.api.profiles || []).findIndex((p) => p.id === profileId);
      if (idx < 0) throw new AIError('配置不存在', { kind: 'config' });
      const prof = st.api.profiles[idx];
      const provider = prof.kind === 'custom' ? new CustomProvider(prof) : prof.kind === 'mock' ? new MockProvider() : new OpenAICompatibleProvider(prof);
      if (prof.kind === 'mock') {
        const out = await provider.chat([{ role: 'user', content: '你好' }], { mockKind: 'test' });
        return { ok: true, model: '本地 Demo 引擎', reply: out.text, latencyMs: Math.round(performance.now() - t0) };
      }
      const messages = [{ role: 'user', content: '你好，请返回“API连接成功”。' }];
      // 推理模型（reasoning）需要思考空间，20 token 远不够；给充足预算并放宽成功判定
      const out = await provider.chat(messages, { maxTokens: 1024, temperature: 0, timeoutMs: prof.timeoutMs || st.ai.timeoutMs });
      const ok = !!out.text;
      const note = out.fromReasoning ? '（内容来自 reasoning_content 回退：content 为空，可能是推理模型思考阶段，连接已通）' : '';
      return { ok, model: prof.model, reply: DS.util.trunc((out.text || '(空)') + note, 200), latencyMs: Math.round(performance.now() - t0), usage: out.usage };
    }
  }

  DS.AI = { AIError, extractJSON, OpenAICompatibleProvider, CustomProvider, MockProvider, PromptBuilder: PB, describeStatus };
  DS.aiService = new AIService();
})(window.DynastySim = window.DynastySim || {});
