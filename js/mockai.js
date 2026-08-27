/* ============================================================================
 * mockai.js — 本地 Demo 推演引擎（MockProvider 的“大脑”）
 * ----------------------------------------------------------------------------
 * 无 API 时提供完整可玩的本地推演：意图识别 → 因果模板 → 数值建议 → 事件生成。
 * 输出与真实 AI 相同的 JSON 结构，走同一条验证/应用管线。
 * 注意：这是规则引擎，不是真 AI；UI 会明确标注「本地 Demo 推演模式」。
 * ==========================================================================*/
(function (DS) {
  'use strict';

  const rngFor = (state, salt) => DS.util.deriveRng(state.seed, 'mock', state.turn, DS.util.hash32(salt));

  /* ---------------- 意图识别 ---------------- */
  const INTENT_RULES = [
    { cat: '宫廷', kw: ['宫中用度', '内帑', '节俭', '停罢', '缩减宫', '裁省'], baseCost: 0 },
    { cat: '赈灾', kw: ['赈', '灾', '济', '抚恤', '流民', '施粥', '义仓'], baseCost: 120000 },
    { cat: '减税', kw: ['减免', '免税', '轻徭薄赋', '缓征', '蠲', '降税', '减税'], baseCost: 80000 },
    { cat: '加税', kw: ['加税', '加征', '增税', '厘金', '盐税', '清欠', '催科'], baseCost: 0 },
    { cat: '吏治', kw: ['贪', '腐', '考成', '吏治', '整肃', '反腐', '纠劾', '都察院彻查', '御史监'], baseCost: 30000 },
    { cat: '外交', kw: ['互市', '边市', '和亲', '岁币', '遣使', '会盟', '通商', '开海'], baseCost: 60000 },
    { cat: '文教', kw: ['科举', '书院', '官学', '教化', '历法'], baseCost: 40000 },
    { cat: '人事', kw: ['罢免', '擢', '起复', '铨选', '升任', '贬为'], baseCost: 10000 },
    { cat: '工程', kw: ['修渠', '修堤', '筑', '治河', '驿', '城垣', '工役', '水利'], baseCost: 90000 },
    { cat: '军事', kw: ['军饷', '练兵', '边墙', '征伐', '北伐', '增兵', '设防', '火器', '募兵', '犒军'], baseCost: 150000 },
  ];

  function detectIntent(text, state) {
    let cat = '其他';
    for (const rule of INTENT_RULES) {
      if (rule.kw.some((k) => text.includes(k))) { cat = rule.cat; break; }
    }
    // 目标地区
    let target = null, regionId = null;
    for (const [alias, rid] of Object.entries(DS.DATA.REGION_ALIASES)) {
      if (text.includes(alias)) { target = alias; regionId = rid; break; }
    }
    // 预算（万两 / 两；支持汉字数字）
    let budget = null;
    const cnMap = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
    function cnNum(s) {
      if (/^[0-9,，]+$/.test(s)) return parseInt(s.replace(/[,，]/g, ''), 10);
      let total = 0, cur = 0;
      for (const ch of s) {
        if (cnMap[ch] != null) cur = (ch === '十' && cur === 0) ? 10 : cur + cnMap[ch];
        else if (ch === '百') { cur = (cur || 1) * 100; total += cur; cur = 0; }
        else if (ch === '千') { cur = (cur || 1) * 1000; total += cur; cur = 0; }
        else if (ch === '万') { total = (total + cur) * 10000; cur = 0; }
      }
      return total + cur;
    }
    const mWan = text.match(/([0-9一二两三四五六七八九十百]+)\s*万\s*(?:两|银)/);
    const mNum = text.match(/([0-9][0-9,，]*)\s*万?\s*(?:两|银)/);
    if (mWan) budget = cnNum(mWan[1]) * 10000;
    else if (mNum) budget = cnNum(mNum[1]);

    const rule = INTENT_RULES.find((r) => r.cat === cat);
    if (budget == null) budget = rule ? rule.baseCost : 50000;
    return { category: cat, target: target || '全国', regionId, budget };
  }

  /* ---------------- 执行能力评估 ---------------- */
  function execQuality(state) {
    const diff = DS.DATA.DIFFICULTIES.find((d) => d.id === state.difficulty) || DS.DATA.DIFFICULTIES[1];
    const C = state.country;
    return {
      eff: diff.execEff * (0.55 + C.bureaucracy / 220) * (1 - Math.min(0.35, C.corruption * 0.004)) * (0.8 + state.ruler.authority / 250),
      inertia: diff.inertia,
    };
  }

  /* ============================ 政令推演 ============================ */
  function simulateOrder(state, text) {
    const rng = rngFor(state, text);
    const C = state.country;
    const intent = detectIntent(text, state);
    const q = execQuality(state);
    const changes = {};
    const events = [];
    const npcChanges = [];
    const regionalChanges = [];
    const future = [];
    const risks = [];
    const decisions = [];
    const narrativeParts = [];

    // 预算可行性
    let cost = intent.category === '宫廷' ? Math.max(20000, intent.budget) : intent.budget;
    let affordable = true;
    if (intent.category !== '宫廷' && cost > 0) {
      if (C.treasury >= cost) affordable = true;
      else if (C.treasury + 200000 >= cost && intent.category === '军事') {
        affordable = true; cost = Math.min(cost, C.treasury);
        decisions.push('因库藏不足，改以最低限度拨付');
      } else { affordable = false; cost = Math.round(C.treasury * 0.6); decisions.push('库藏匮乏，仅能折半筹办'); }
    }

    switch (intent.category) {
      case '赈灾': {
        const reg = intent.regionId ? DS.State.getRegion(state, intent.regionId)
          : state.regions.find((r) => r.disaster) || state.regions.find((r) => r.unrest > 50) || state.regions[0];
        const realCost = affordable ? cost : 0;
        changes.treasury = -realCost;
        const leak = 1 - 0.4 * (C.corruption / 100) * q.eff;
        const effGain = realCost * leak / 24000;
        changes.publicSupport = +(2 + effGain * 1.2).toFixed(1);
        changes.stability = +(1.5 + effGain * 0.8).toFixed(1);
        narrativeParts.push(`诏令所至，${reg.name}开仓放粮、设粥厂安置流民。`);
        if (reg.disaster && rng() < 0.45) {
          reg.disaster.severity = Math.max(1, reg.disaster.severity - 1);
          narrativeParts.push(`加之雨雪稍匀，${reg.name}灾情略有纾解。`);
        }
        events.push({ title: `${reg.name}赈济`, description: `朝廷发银 ${DS.util.fmtMoney(realCost)} 赈济${reg.name}，饥民暂得安插。`, severity: 'medium', regionId: reg.id });
        regionalChanges.push({ region_id: reg.id, changes: { loyalty: +(3 + effGain * 1.5).toFixed(1), unrest: -(4 + effGain * 2).toFixed(1) }, reason: '朝廷赈济' });
        if (C.corruption > 50 && rng() < 0.5) {
          future.push({ after_turns: 2, title: `${reg.name}赈款遭截留之疑`, description: `御史风闻${reg.name}官吏于赈银中上下其手，请旨彻查。`, severity: 'medium' });
          risks.push('赈银可能被层层侵蚀');
        }
        npcChanges.push({ id: 'c8', trust_delta: 4, reason: '朝廷拨款赈灾，地方得纾燃眉' });
        npcChanges.push({ id: 'c1', loyalty: -1, reason: '户部心疼这一大笔开支' });
        break;
      }
      case '减税': {
        const reg = intent.regionId ? DS.State.getRegion(state, intent.regionId) : null;
        const targets = reg ? [reg] : state.regions;
        changes.publicSupport = +(3 + rng() * 3).toFixed(1);
        changes.treasury = -Math.round(cost * 0.9);
        for (const r of targets) {
          r.taxRate = Math.max(8, r.taxRate - 3);
          regionalChanges.push({ region_id: r.id, changes: { loyalty: 4, unrest: -5 }, reason: '税负减轻' });
        }
        narrativeParts.push('减税诏下，闾阎相庆，然户部岁入随之短绌。');
        future.push({ after_turns: 2, title: '岁入短绌之患', description: '减税之后，各处解运渐少，度支益窘。', severity: 'low' });
        npcChanges.push({ id: 'c1', loyalty: -2, reason: '减税令户部更难为无米之炊' });
        npcChanges.push({ id: 'c3', trust_delta: 1, reason: '圣心仁恕，首辅称善' });
        break;
      }
      case '加税': {
        const reg = intent.regionId ? DS.State.getRegion(state, intent.regionId) : null;
        const targets = reg ? [reg] : state.regions;
        changes.treasury = cost;
        changes.publicSupport = -(3 + rng() * 3).toFixed(1);
        for (const r of targets) {
          r.taxRate = Math.min(40, r.taxRate + 3);
          regionalChanges.push({ region_id: r.id, changes: { loyalty: -4, unrest: 4 }, reason: '税负加重' });
          if (r.unrest > 55) risks.push(`${r.name}民怨已深，加税恐激变`);
        }
        narrativeParts.push('加征之令既出，州县催科日急，民间颇有怨言。');
        npcChanges.push({ id: 'c9', trust_delta: -3, reason: '江南士绅托人进言，怨朝廷催科太急' });
        npcChanges.push({ id: 'c1', trust_delta: 3, reason: '户部得以稍舒眉目' });
        break;
      }
      case '军事': {
        const reg = intent.regionId ? DS.State.getRegion(state, intent.regionId) : null;
        if (affordable) changes.treasury = -cost;
        const boost = affordable ? (4 + q.eff * 5) : 0;
        changes.militaryPower = +boost.toFixed(1);
        changes.morale = affordable ? 3 : -2;
        const dip = [...state.diplomacy].sort((a, b) => b.borderPressure - a.borderPressure)[0];
        if (affordable) {
          if (reg) regionalChanges.push({ region_id: reg.id, changes: { military: 5, security: 2 }, reason: '增兵设防' });
          narrativeParts.push(`粮械次第运转，边镇士气稍振；${dip.name}闻讯，游骑敛迹。`);
          changes.borderPressure = -3;
          npcChanges.push({ id: 'c10', trust_delta: 4, reason: '饷械足额，大将感奋' });
          npcChanges.push({ id: 'c2', trust_delta: 3, reason: '所请多获允准' });
        } else {
          narrativeParts.push(`然库藏空竭，拨付不及什一，将士失望，边备如故。`);
          npcChanges.push({ id: 'c10', trust_delta: -5, reason: '请饷不至，怨望形于辞色' });
        }
        break;
      }
      case '吏治': {
        changes.corruption = -((2 + q.eff * 4) * (1 - q.inertia * 0.4)).toFixed(1);
        changes.bureaucracy = +(1 + q.eff * 2).toFixed(1);
        changes.authority = 1.5;
        narrativeParts.push('缇骑四出，考察官吏。官场一时屏息，然积重难返，阴违者众。');
        const corrupt = state.characters.filter((c) => c.corruption >= 40).sort((a, b) => b.corruption - a.corruption)[0];
        if (corrupt) {
          events.push({ title: `${corrupt.role}${corrupt.name}惶惶不自安`, description: `整饬吏治之风既起，${corrupt.name}暗中打点，以求自保。`, severity: 'low', characterId: corrupt.id });
          npcChanges.push({ id: corrupt.id, loyalty: -3, corruption: -4, reason: '风声鹤唳，收敛行迹' });
        }
        npcChanges.push({ id: 'c12', trust_delta: 3, reason: '密察之事正合其职' });
        npcChanges.push({ id: 'c6', trust_delta: 3, reason: '言路为之吐气' });
        npcChanges.push({ id: 'c4', loyalty: -3, reason: '吏部党羽被查，心怀忐忑' });
        future.push({ after_turns: 3, title: '官场消极怠工', description: '官吏以多做多错自保，文书迁延，政务效率反有下降。', severity: 'low' });
        break;
      }
      case '工程': {
        if (affordable) {
          changes.treasury = -cost;
          const reg = intent.regionId ? DS.State.getRegion(state, intent.regionId) : state.regions[4];
          regionalChanges.push({ region_id: reg.id, changes: { agriculture: 3, security: 2 }, reason: '兴修水利工事' });
          changes.publicSupport = 2;
          changes.food = 20000;
          narrativeParts.push(`征夫购料，畚锸并举。${reg.name}父老聚观，皆言圣天子在上。`);
          npcChanges.push({ id: 'c7', trust_delta: 4, reason: '工部所请获准，得以展布所长' });
          future.push({ after_turns: 3, title: '工役靡费之议', description: '工科给事中上疏，称工费浩繁，请核减浮冒。', severity: 'low' });
        } else narrativeParts.push('工部领旨，然度支无银，只得先行勘估，工期遥遥。');
        break;
      }
      case '外交': {
        const d = [...state.diplomacy].sort((a, b) => b.threat - a.threat)[0];
        if (affordable) changes.treasury = -cost;
        const improve = affordable ? (8 + rng() * 6) : -3;
        d.relation = DS.util.clamp(d.relation + improve, -100, 100);
        d.borderPressure = DS.util.clamp(d.borderPressure - (affordable ? 5 : -2), 0, 100);
        changes.borderPressure = affordable ? -3 : 2;
        narrativeParts.push(affordable
          ? `遣使往来，许以边市。${d.name}酋长受币而喜，约期不犯。`
          : `国用匮乏，外交之费无从筹措，使者赍书而往，空言而已，${d.name}颇为不满。`);
        events.push({ title: `${d.name}遣使报聘`, description: `${d.name}回派使团，边市重开，商旅稍稍复业。`, severity: 'low' });
        break;
      }
      case '人事': {
        changes.authority = 1;
        narrativeParts.push('人事更动既颁，朝野侧目。被擢者感激涕零，被黜者怨望诽谤。');
        const cand = state.characters.filter((c) => c.ability >= 75).sort(() => rng() - 0.5)[0];
        if (cand) npcChanges.push({ id: cand.id, trust_delta: 3, reason: '蒙陛下超擢之恩' });
        break;
      }
      case '文教': {
        changes.treasury = -cost;
        changes.publicSupport = 1.5;
        changes.bureaucracy = 1;
        narrativeParts.push('兴学之诏颁于州县，士林传诵，谓朝廷右文之意。');
        npcChanges.push({ id: 'c11', trust_delta: 3, reason: '祭酒喜见文教复兴' });
        break;
      }
      case '宫廷': {
        const saved = cost;
        changes.treasury = saved;
        changes.authority = -0.5;
        changes.publicSupport = 1;
        narrativeParts.push(`内廷用度裁省银 ${DS.util.fmtMoney(saved)}，转充度支。宫中不免腹诽，外廷则称颂圣德。`);
        break;
      }
      default: {
        // 泛化处理：视作一般性指示，效果轻微且带不确定性
        changes.authority = rng() < 0.3 ? 1 : 0;
        changes.stability = +(rng() - 0.4).toFixed(1);
        narrativeParts.push('谕旨交下部院议行。司官拟票呈进，谓兹事体大，须从长计议——本回合未生立竿见影之效。');
        decisions.push('着各衙门妥议具奏');
      }
    }

    // 历史惯性折扣：重大变革在惯性强的模式下打折并产生摩擦
    if (['吏治', '加税', '减税'].includes(intent.category) && q.inertia > 0.7) {
      changes.stability = Number((((changes.stability || 0)) - 0.5).toFixed(1));
      risks.push('祖制所系，朝中或有反弹');
    }

    // 国库硬约束：透支转国债
    if ((changes.treasury || 0) < 0 && C.treasury + changes.treasury < 0) {
      const deficit = -(C.treasury + changes.treasury);
      changes.debt = deficit;
      changes.treasury = -C.treasury;
      narrativeParts.push(`不敷之数 ${DS.util.fmtMoney(deficit)} 记入国债，户部忧心忡忡。`);
    }

    const turnSummary = `${intent.category}之令已行：` + (Object.keys(changes).length
      ? Object.entries(changes).slice(0, 3).map(([k, v]) => `${metricName(k)} ${v > 0 ? '+' : ''}${v}`).join('、')
      : '暂无明显数值变化');

    return {
      intent,
      turn_summary: turnSummary,
      narrative: narrativeParts.join('') || '政令已交部执行。',
      decisions,
      state_changes: changes,
      events,
      npc_changes: npcChanges,
      regional_changes: regionalChanges.filter(Boolean),
      new_risks: risks,
      future_consequences: future,
      historical_record: `${DS.util.dateLabel(state.date)}，帝下${intent.category}之诏。`,
    };
  }

  function metricName(k) {
    const map = {
      treasury: '国库', food: '粮食', publicSupport: '民心', stability: '稳定',
      corruption: '腐败', militaryPower: '军力', morale: '士气', authority: '皇权',
      borderPressure: '边压', debt: '国债', population: '人口', bureaucracy: '行政',
    };
    return map[k] || k;
  }

  /* ============================ 廷议 ============================ */
  const ROLE_VIEWS = {
    '户部尚书': (s) => ({
      stance: s.country.treasury < 150000 ? '忧虑' : '谨慎乐观',
      support: s.country.treasury < 150000 ? 'cautious' : 'support',
      line: `今太仓实存 ${DS.util.fmtMoney(s.country.treasury)}，月出几 ${DS.util.fmtMoney(Math.round(52000 + s.country.militaryPower * 1150))}。臣夜算账目，寝食难安。若再有大征大役，须先筹的款；不然，宁可缓办，不可虚糜。`,
    }),
    '兵部尚书': () => ({
      stance: '主战而忧饷',
      support: 'cautious',
      line: '九边将士欠饷数月，营中马匹倒毙十之二三。军心者，国之长城也。陛下若问臣意见，臣只有一句：足饷足食，然后可言战守。',
    }),
    '内阁首辅': (s) => ({
      stance: '持重',
      support: 'cautious',
      line: `老臣以为，治大国如烹小鲜。今民心 ${Math.round(s.country.publicSupport)}，乱源在西北灾地与积欠之饷。愿陛下先其所急，徐图其余，勿以一朝之忿兴不可成之功。`,
    }),
    '吏部尚书': () => ({
      stance: '圆融',
      support: 'support',
      line: '外官俸薄而责繁，非爱身家者谁肯任事？臣掌铨衡，深知其中甘苦。若欲吏治清明，当宽其俸、严其罚，二者并行，庶乎有效。',
    }),
    '礼部尚书': () => ({
      stance: '崇礼',
      support: 'cautious',
      line: '国家大事，惟祀与戎。然臣以为教化尤先：人心正则风俗淳。愿陛下慎选师儒，重刊经籍，使天下晓然于名分之义。',
    }),
    '都察院左都御史': (s) => ({
      stance: '峻烈',
      support: 'support',
      line: `臣风闻官场贪墨，十官九弊。腐败之势已达 ${Math.round(s.country.corruption)}！请陛下赐臣纠察之权，自江南逋赋查起，穷究到底。纲纪一振，则百事可为。`,
    }),
    '工部侍郎': () => ({
      stance: '实干',
      support: 'support',
      line: '黄河堤工、西北渠堰，图纸俱在臣案头。与其坐论，不如施工。每十万两可活一河两岸数万生灵，此最划算的买卖，臣敢保无虚冒。',
    }),
    '陕西巡抚': () => ({
      stance: '焦灼',
      support: 'cautious',
      line: '臣不敢言他事，只乞陛下垂怜陕右百万饥黎！存粮已不足两月，若赈银再迟，臣唯有一死以谢，恐百姓不肯随臣死耳。',
    }),
    '江南巡抚': () => ({
      stance: '婉转',
      support: 'support',
      line: '江南财赋甲天下，亦甲天下之口舌。逋赋自有积因，愿朝廷宽以时日，臣愿以身家保三年清完旧欠——但新赋请勿再加。',
    }),
    '征虏大将军': () => ({
      stance: '傲岸',
      support: 'support',
      line: '末将读书少，只会打仗。边墙外胡马年年南下，与其岁岁输币乞和，不如一战定边！只求陛下给足三月粮饷，末将愿立军令状。',
    }),
    '国子监祭酒': (s) => ({
      stance: '清议',
      support: 'cautious',
      line: `士心即民心之本。今诸生议论纷纭，皆缘民生多艰（民心 ${Math.round(s.country.publicSupport)}）。臣乞陛下开言路、恤民瘼，则浮议自息，士气自伸。`,
    }),
    '锦衣卫指挥使': () => ({
      stance: '阴沉',
      support: 'support',
      line: '臣职在缉事，不敢妄议钱粮。惟近日京中谣诼纷繁，有大臣与外藩书信往来频仍，臣已录档呈御览，伏候圣裁。',
    }),
  };

  function runCouncil(state, charIds) {
    const rng = rngFor(state, 'council' + charIds.join(','));
    const openings = ['臣启陛下：', '臣谨对：', '臣愚昧之见：', '臣冒死陈言：', '臣俯伏奏闻：'];
    const speeches = charIds.map((id, i) => {
      const c = DS.State.getCharacter(state, id);
      if (!c) return null;
      const view = ROLE_VIEWS[c.role] ? ROLE_VIEWS[c.role](state) : {
        stance: '依违其间', support: 'cautious',
        line: '臣职分所在，不敢旁骛。惟愿陛下乾纲独断，臣等谨遵奉行。',
      };
      return {
        characterId: c.id,
        name: c.name,
        role: c.role,
        faction: c.faction,
        stance: view.stance,
        support: view.support,
        content: openings[(i + Math.floor(rng() * openings.length)) % openings.length] + view.line,
      };
    }).filter(Boolean);
    return {
      speeches,
      consensus: speeches.every((x) => x.support === 'support') ? '众议佥同'
        : speeches.some((x) => x.support === 'support') ? '各有主张' : '莫衷一是',
      advice_summary: '以上诸臣之言，供陛下圣裁。采纳某议可直接写入圣旨。',
    };
  }

  /* ============================ NPC 对话 ============================ */
  function dialogue(state, charId, message) {
    const c = DS.State.getCharacter(state, charId);
    if (!c) return { reply: '……（此人不在朝中。）', attitude: '困惑', trust_delta: 0 };
    const rng = rngFor(state, 'dlg' + charId + message);
    const C = state.country;
    const m = message || '';

    // 秘密保护：除非已在 flags.revealedSecrets，否则绝不提及
    const knowsSecret = (state.flags.revealedSecrets || []).includes(c.id);

    let reply;
    if (/财|库|银|钱|税|饷/.test(m)) {
      reply = `陛下垂询财政。如今太仓存银 ${DS.util.fmtRes(C.treasury, '两')}，各处请讨文书却堆积如案。臣以为，开源不如节流，节流不如清源——把${C.corruption > 50 ? '那些层层伸手的手' : '冗费'}清一清，比加派百姓强得多。`;
    } else if (/边|敌|狄|战|兵|防/.test(m)) {
      reply = `边事臣不敢欺瞒：${[...state.diplomacy].sort((a, b) => b.borderPressure - a.borderPressure)[0].name}压境，边压已近 ${Math.round(C.borderPressure)}。我军力 ${Math.round(C.militaryPower)}，勉强自守有余，远征则不足。将帅能战，但士兵要吃饭。`;
    } else if (/灾|荒|民|饿|赈/.test(m)) {
      const dis = state.regions.filter((r) => r.disaster);
      reply = dis.length
        ? `灾情最重的仍是${dis.map((r) => r.name + r.disaster.type).join('、')}。臣接得塘报，流民扶老携幼，道殣相望……乞陛下速断，迟一月便多白骨一山。`
        : `托陛下洪福，眼下诸路未有急灾。但常平仓空虚，一旦年景不好，悔之晚矣，宜早蓄积。`;
    } else if (/贪|腐|奸|查/.test(m)) {
      reply = C.corruption >= 50
        ? '（左右看了看，压低声音）陛下既问到这层……官场积弊已深，臣只能说：水至清则无鱼。若陛下决意痛惩，臣万死不辞；只是牵连必广，还望圣心默运。'
        : '近来吏治还算安静，偶有小案，都已按律发落。若陛下要立威，臣以为宜择典型，不必广株连。';
    } else if (/朕|忠|你对我|信任/.test(m)) {
      reply = c.loyalty >= 70
        ? '臣蒙陛下信任，敢不肝脑涂地。只是臣年老体衰，恐怕侍奉陛下的日子一天少过一天，唯愿陛下早用贤才。'
        : '臣……世受国恩，自当尽力。（目光微微躲闪）朝局复杂，臣所言未必皆可采信，还望陛下明察。';
    } else if (/建议|策|如何|怎么办|你看/.test(m)) {
      const worstR = [...state.regions].sort((a, b) => b.unrest - a.unrest)[0];
      reply = `臣僭越说一句：当务之急有三——其一，${worstR.name}乱险最高，宜先安抚；其二，${C.treasury < 150000 ? '库藏见底，速筹开源' : '库藏虽可支，亦当未雨绸缪'}；其三，${C.morale < 50 ? '军心不稳，饷不可欠' : '边军尚稳，可徐图恢复'}。三事有序，天下可安。`;
    } else {
      reply = DS.util.pick(rng, [
        '臣谨聆圣训。臣职司本衙，凡有所命，敢不夙夜匪懈。',
        '陛下圣明。此事容臣回去核查卷册，明日再详细回奏。',
        '臣愚钝，一时拿不准，不敢妄对。容臣思之三日后复命。',
        '（长揖）陛下宵衣旰食，臣等敢不效死。惟愿善保圣躬。',
      ]);
    }
    if (knowsSecret && c.secrets.length && rng() < 0.5) {
      reply += '（低声）至于臣心中所讳的那件事……陛下既然已知，臣无所逃罪，唯凭圣裁。';
    }
    return { reply, attitude: c.loyalty >= 70 ? '恳切' : c.loyalty >= 50 ? '恭谨' : '疏离', trust_delta: 1 };
  }

  /* ============================ 史官评语 ============================ */
  function verdict(state, ending) {
    const sc = ending.scores;
    const bestDim = Object.entries(sc).sort((a, b) => b[1] - a[1])[0][0];
    const dimName = { economy: '理财', livelihood: '恤民', military: '武功', political: '御下', diplomatic: '驭夷', reform: '变法', stabilityScore: '持盈' }[bestDim] || '守成';
    const years = ending.stats.reignYears;
    const tone = ['golden', 'revival', 'reform'].includes(ending.id) ? '褒'
      : ['replace', 'collapse', 'split'].includes(ending.id) ? '贬' : '平';
    const open = tone === '褒'
      ? `史臣曰：上践祚以来，御宇${years}载，励精图治。`
      : tone === '贬' ? `史臣曰：上即位以来，${years}载之间，风波迭起。`
      : `史臣曰：上临御${years}载，无功过之尤者。`;
    const mid = `其所长者${dimName}也；${sc.political < 50 ? '然御下乏术，权移于下。' : ''}${sc.livelihood < 50 ? '民生凋敝，赈济不时，此其失也。' : ''}${sc.military >= 60 ? '四夷惮其威。' : ''}`;
    const close = tone === '褒' ? '《诗》云：「靡不有初，鲜克有终。」上其庶几乎！' : tone === '贬' ? '呜呼，天命靡常，惟德是辅。后之人主可不鉴哉！' : '盖棺论定，是非付之千秋。';
    return `${open}${mid}${close}`;
  }

  DS.Mock = { simulateOrder, runCouncil, dialogue, verdict, detectIntent };
})(window.DynastySim = window.DynastySim || {});
