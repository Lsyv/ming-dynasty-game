/* ============================================================================
 * storage.js — 数据持久化
 * ----------------------------------------------------------------------------
 * · Settings：localStorage「dynasty_settings_v1」（API Profile、Prompt、推演参数…）
 * · Saves：每槽一个 key「dynasty_save_<slot>」，含 checksum 完整性校验与版本迁移
 * · Scenarios：本地剧本库「dynasty_scenarios_v1」
 * 安全：API Key 仅保存在本机 localStorage；导出配置时默认剥离 Key。
 * ==========================================================================*/
(function (DS) {
  'use strict';

  const LS_SETTINGS = 'dynasty_settings_v1';
  const LS_SCENARIOS = 'dynasty_scenarios_v1';
  const SAVE_PREFIX = 'dynasty_save_';
  const SLOTS = ['auto', 'slot1', 'slot2', 'slot3', 'slot4', 'slot5'];

  /* ---------------- 默认设置 ---------------- */
  function defaultSettings() {
    return {
      schemaVersion: 1,
      lang: 'zh-CN',
      theme: 'classic',          // classic | dark | light
      reduceMotion: false,
      autosave: true,
      debugMode: false,
      difficulty: 'standard',
      simulation: {              // 推演参数（0~1）
        inertia: 0.6,            // 历史惯性
        randomness: 0.5,         // 随机性
        npcIndependence: 0.6,    // NPC 独立性
        eventDensity: 0.5,       // 事件密度
        longTermImpact: 0.6,     // 长期后果强度
      },
      ai: {
        timeoutMs: 60000,
        maxRetries: 1,
        quickMode: 'standard',   // fast | standard | quality （仅影响默认 maxTokens 建议）
      },
      api: {
        profiles: [
          { id: 'mock_local', name: '本地 Demo 引擎（无需 API）', kind: 'mock' },
        ],
        purposes: {              // 用途 → profileId（多模型分别配置）
          simulation: 'mock_local',
          dialogue: 'mock_local',
          summary: 'mock_local',
        },
      },
      prompts: DS.util.deepClone(DS.DATA.DEFAULT_PROMPTS),
    };
  }

  let settingsCache = null;

  function loadSettings() {
    if (settingsCache) return settingsCache;
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      settingsCache = raw ? migrateSettings(JSON.parse(raw)) : defaultSettings();
    } catch (_e) {
      settingsCache = defaultSettings();
    }
    return settingsCache;
  }

  function saveSettings(next) {
    settingsCache = next || settingsCache || defaultSettings();
    try {
      localStorage.setItem(LS_SETTINGS, JSON.stringify(settingsCache));
      return true;
    } catch (e) {
      console.warn('设置保存失败（可能存储已满）', e);
      return false;
    }
  }

  function resetSettings() {
    settingsCache = defaultSettings();
    saveSettings();
    return settingsCache;
  }

  function migrateSettings(raw) {
    const def = defaultSettings();
    const merged = deepMerge(def, raw);
    merged.schemaVersion = def.schemaVersion;
    // 保证 mock profile 永远存在
    if (!merged.api.profiles.some((p) => p.id === 'mock_local')) {
      merged.api.profiles.unshift({ id: 'mock_local', name: '本地 Demo 引擎（无需 API）', kind: 'mock' });
    }
    for (const k of Object.keys(merged.api.purposes)) {
      if (!merged.api.profiles.some((p) => p.id === merged.api.purposes[k])) {
        merged.api.purposes[k] = 'mock_local';
      }
    }
    return merged;
  }

  function deepMerge(target, src) {
    for (const [k, v] of Object.entries(src || {})) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        target[k] = target[k] && typeof target[k] === 'object' ? target[k] : {};
        deepMerge(target[k], v);
      } else if (v !== undefined) target[k] = v;
    }
    return target;
  }

  /* ---------------- 存档 ---------------- */
  function saveKey(slot) { return SAVE_PREFIX + slot; }

  /**
   * @returns {{ok:boolean, error?:string}} 
   */
  function writeSave(slot, state, label) {
    try {
      const payload = {
        kind: 'dynasty-save',
        version: DS.State.SCHEMA_VERSION,
        timestamp: DS.util.nowISO(),
        slot,
        label: label || '',
        meta: {
          dynasty: state.dynasty.name,
          ruler: state.ruler.name,
          date: DS.util.dateLabel(state.date),
          turn: state.turn,
        },
        gameState: state,
      };
      payload.checksum = DS.util.checksum(JSON.stringify(payload.gameState));
      localStorage.setItem(saveKey(slot), JSON.stringify(payload));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: '存档写入失败：' + (e && e.message ? e.message : '存储空间不足') };
    }
  }

  function readSave(slot) {
    try {
      const raw = localStorage.getItem(saveKey(slot));
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || data.kind !== 'dynasty-save' || !data.gameState) {
        return { corrupt: true, error: '存档结构不合法' };
      }
      const sum = DS.util.checksum(JSON.stringify(data.gameState));
      const mismatch = data.checksum && sum !== data.checksum;
      const state = DS.State.normalizeState(data.gameState);
      return { data, state, checksumMismatch: !!mismatch };
    } catch (e) {
      return { corrupt: true, error: '存档解析失败：' + (e && e.message ? e.message : '') };
    }
  }

  function deleteSave(slot) { localStorage.removeItem(saveKey(slot)); }

  function listSaves() {
    return SLOTS.map((slot) => {
      const r = readSave(slot);
      if (!r) return { slot, empty: true };
      if (r.corrupt) return { slot, empty: false, corrupt: true, error: r.error };
      return {
        slot, empty: false, corrupt: false,
        checksumMismatch: r.checksumMismatch,
        timestamp: r.data.timestamp,
        label: r.data.label,
        meta: r.data.meta || {},
      };
    });
  }

  /** 导出：dynasty-save-YYYY-MM-DD.json */
  function exportSave(slot) {
    const r = readSave(slot);
    if (!r || r.corrupt) throw new Error('该存档不存在或已损坏');
    DS.util.download(`dynasty-save-${DS.util.todayStamp()}.json`, JSON.stringify(r.data, null, 2));
  }

  /** 导入：验证 kind/version/checksum 后写入第一个空槽（或指定槽） */
  function importSave(text, slot) {
    let data;
    try { data = JSON.parse(text); } catch (_e) { throw new Error('文件不是合法 JSON'); }
    if (!data || data.kind !== 'dynasty-save') throw new Error('这不是王朝模拟器存档文件（缺少 kind 标识）');
    if (!data.gameState || typeof data.gameState !== 'object') throw new Error('存档缺少 gameState');
    if (data.version > DS.State.SCHEMA_VERSION) throw new Error(`存档版本(${data.version})高于当前支持的版本(${DS.State.SCHEMA_VERSION})，请升级游戏`);
    const sum = DS.util.checksum(JSON.stringify(data.gameState));
    const mismatch = data.checksum && sum !== data.checksum;
    const target = slot || firstEmptySlot() || 'slot5';
    const wr = writeSave(target, DS.State.normalizeState(data.gameState), data.label || '导入存档');
    if (!wr.ok) throw new Error(wr.error);
    return { slot: target, checksumMismatch: !!mismatch };
  }

  function firstEmptySlot() {
    for (const s of SLOTS) if (s !== 'auto' && !localStorage.getItem(saveKey(s))) return s;
    return null;
  }

  /* ---------------- 本地剧本库 ---------------- */
  function listScenarios() {
    try { return JSON.parse(localStorage.getItem(LS_SCENARIOS) || '[]'); }
    catch (_e) { return []; }
  }
  function saveScenarios(list) {
    localStorage.setItem(LS_SCENARIOS, JSON.stringify(list.slice(0, 30)));
  }
  function upsertScenario(sc) {
    const list = listScenarios();
    sc.id = sc.id || ('sc_u_' + DS.util.uid('').slice(2));
    const i = list.findIndex((x) => x.id === sc.id);
    if (i >= 0) list[i] = sc; else list.push(sc);
    saveScenarios(list);
    return sc;
  }
  function deleteScenario(id) {
    saveScenarios(listScenarios().filter((x) => x.id !== id));
  }
  function importScenario(text) {
    const sc = JSON.parse(text);
    if (!sc || !sc.name) throw new Error('剧本缺少 name 字段');
    sc.builtin = false;
    return upsertScenario(sc);
  }
  function exportScenario(sc) {
    DS.util.download('scenario.json', JSON.stringify(sc, null, 2));
  }

  /* ---------------- 清空 ---------------- */
  function clearAll() {
    for (const s of SLOTS) deleteSave(s);
    localStorage.removeItem(LS_SETTINGS);
    localStorage.removeItem(LS_SCENARIOS);
    settingsCache = null;
  }

  DS.Storage = {
    defaultSettings, loadSettings, saveSettings, resetSettings,
    SLOTS, listSaves, readSave, writeSave, deleteSave, exportSave, importSave,
    listScenarios, upsertScenario, deleteScenario, importScenario, exportScenario,
    clearAll,
  };
})(window.DynastySim = window.DynastySim || {});
