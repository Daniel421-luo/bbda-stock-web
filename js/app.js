/**
 * BBDA 选股系统 - app.js v4.2
 * 市场环境1:1对应 · 美股指数 · 2×2漏斗
 */

const CONFIG = {
  TENCENT_BASE: 'https://qt.gtimg.cn/q=',

  // A股指数
  INDICES_CN: [
    { code: 'sh000001', name: '上证指数' },
    { code: 'sz399001', name: '深证成指' },
    { code: 'sz399006', name: '创业板指' },
    { code: 'sh000300', name: '沪深300'  },
  ],

  // 美股指数（腾讯财经 v_us*，无CORS）
  INDICES_US: [
    { code: 'usNDX', name: '纳斯达克100' },
    { code: 'usINX', name: '标普500'  },
    { code: 'usDJI', name: '道琼斯'   },
  ],

  // 持仓
  HOLDINGS: [
    { name: '生益科技', code: 'sh600183', cost: 67.50, shares: 200, sector: '覆铜板' },
  ],

  // 扫描股票池：8板块 × 5只 = 40只
  SECTORS: {
    '金融':    ['sh601318', 'sh600036', 'sh600030', 'sh601166', 'sz000001'],
    '消费':    ['sz000858', 'sh600519', 'sh601888', 'sz000568', 'sh600887'],
    '科技':    ['sz300750', 'sz002475', 'sz300059', 'sz000063', 'sh600183'],
    '医药':    ['sh600276', 'sz300015', 'sz300760', 'sz000538', 'sh600196'],
    '新能源':  ['sz002594', 'sh601012', 'sz300014', 'sh600406', 'sz002074'],
    '电力':    ['sh600900', 'sh600905', 'sz000883', 'sh600011', 'sz002608'],
    '地产':    ['sz000002', 'sh600048', 'sz001979', 'sh601155', 'sz000402'],
    '制造':    ['sz000333', 'sz002415', 'sh600309', 'sz000651', 'sz002050'],
  },
};

// =============================================
// 工具
// =============================================
function log(msg, type = 'normal') {
  const area = document.getElementById('logArea');
  const line = document.createElement('div');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  line.className = `log-line ${type}`;
  line.textContent = `[${time}] ${msg}`;
  area.appendChild(line);
  area.scrollTop = area.scrollHeight;
}
function $(id) { return document.getElementById(id); }

// =============================================
// 腾讯财经解析
// =============================================
function parseTencent(raw) {
  try {
    const m = raw.match(/^v_(us\w+|sh\d+|sz\d+)/);
    const codeFull = m ? m[1] : '';
    const match = raw.match(/="([^"]+)"/);
    if (!match) return null;
    const f = match[1].split('~');
    return {
      codeFull,
      name:   f[1]  || '',
      code:   f[2]  || '',
      price:  parseFloat(f[3])  || 0,
      yclose: parseFloat(f[4])  || 0,
      open:   parseFloat(f[5])  || 0,
      vol:    parseFloat(f[6])  || 0,
      change: parseFloat(f[32]) || 0,
      absChg: parseFloat(f[33]) || 0,
    };
  } catch { return null; }
}

async function fetchTencent(codes) {
  const url = CONFIG.TENCENT_BASE + codes.join(',');
  const r   = await fetch(url);
  const buf = await r.arrayBuffer();
  const text = new TextDecoder('gbk').decode(buf);
  const map = {};
  text.trim().split('\n').forEach(line => {
    const d = parseTencent(line);
    if (d && d.code) map[d.codeFull] = d;
  });
  return map;
}

// =============================================
// 美股指数 — 腾讯财经（fetchTencent里统一处理）
// v_usIXIC格式：price=f[3], yclose=f[4], change=f[32]
// =============================================
async function fetchAllData() {
  const codes = [
    ...CONFIG.INDICES_CN.map(i => i.code),
    ...CONFIG.INDICES_US.map(i => i.code),   // usIXIC/usSPX/usDJI
    ...CONFIG.HOLDINGS.map(h => h.code),
    ...Object.values(CONFIG.SECTORS).flat(),
  ];
  log(`获取 ${codes.length} 项数据...`, 'info');
  return fetchTencent(codes);
}

// =============================================
// 市场环境
// =============================================
function assessMarket(cnIndices) {
  if (!cnIndices.length) return { beta:'未知', sentiment:50, fitness:50, position:'观望' };
  const avg = cnIndices.reduce((s,i) => s + i.change, 0) / cnIndices.length;
  const beta      = avg > 0.5 ? '强势' : avg < -0.5 ? '弱势' : '中性';
  const sentiment = Math.round(Math.min(100, Math.max(0, 50 + avg * 30)));
  const fitness   = Math.round(Math.min(100, Math.max(0, 50 + avg * 8)));
  let position = '轻仓';
  if (beta === '强势' && fitness > 65) position = '满仓';
  else if (beta === '强势' && fitness > 50) position = '重仓';
  else if (beta === '弱势' && fitness < 40) position = '空仓';
  else if (avg < -1) position = '减仓';
  return { beta, sentiment, fitness, position };
}

// =============================================
// L1 信号扫描（宽松）
// 通过：涨幅>0.5% OR 量比>1.5 OR 股价>开盘
// 排除：pct<-3% 且 vol<5万手
// =============================================
function layer1Signal(codeFull, dataMap) {
  const d = dataMap[codeFull];
  if (!d || !d.price) return null;
  const pct      = d.change;
  const vol     = d.vol / 10000;
  const priceUp = d.price > d.yclose;
  const aboveOpen = d.price > d.open;

  let signal = 0;
  if (pct > 0.5 && pct < 9) signal += 30;
  if (priceUp)   signal += 20;
  if (aboveOpen) signal += 10;
  if (pct > 3)   signal += 15;
  if (vol > 20)  signal += 15;

  if (pct < -3 && vol < 5) return null;  // 暴跌无量排除

  return { codeFull, name: d.name, code: codeFull, price: d.price,
    yclose: d.yclose, pct, vol, signal, priceUp, aboveOpen };
}

// =============================================
// L2 板块确认（严格AND）
// 条件：板块内强势股≥2 且 板块均涨>0.5%
// =============================================
function layer2Sector(stocksL1) {
  const passed = [];
  for (const [sectorName, codes] of Object.entries(CONFIG.SECTORS)) {
    const ss = codes.map(c => stocksL1.find(s => s.code === c)).filter(Boolean);
    if (!ss.length) continue;
    const avgPct = ss.reduce((s, x) => s + x.pct, 0) / ss.length;
    const strong  = ss.filter(s => s.pct > 1).length;
    if (strong >= 2 && avgPct > 0.5) {
      ss.forEach(s => {
        s.sector = sectorName;
        s.sectorAvg = parseFloat(avgPct.toFixed(2));
        s.l2Reason = `${strong}只强势/${avgPct.toFixed(1)}%均涨`;
        passed.push(s);
      });
    }
  }
  return passed;
}

// =============================================
// L3 量化评分
// 关注指数 = 涨幅25% + 量比25% + 资金15% + 板块35%
// 门槛：≥60分
// =============================================
function layer3Score(stocksL2, dataMap) {
  const scored = stocksL2.map(s => {
    const d = dataMap[s.code];
    if (!d) return s;
    const pct = d.change;
    const vol = d.vol / 10000;
    const pctScore    = Math.min(100, Math.max(0, Math.round((pct + 3) / 13 * 100)));
    const volScore    = Math.min(100, Math.round(vol / 20 * 100));
    const fundScore   = Math.min(100, Math.round((pctScore + volScore) / 2));
    const sectorScore = Math.min(100, Math.round((s.sectorAvg + 2) / 4 * 100));
    const totalScore = Math.round(
      pctScore * 0.25 + volScore * 0.25 + fundScore * 0.15 + sectorScore * 0.35
    );
    return { ...s, pctScore, volScore, fundScore, sectorScore, totalScore };
  });
  return scored.filter(s => s.totalScore >= 60).sort((a, b) => b.totalScore - a.totalScore);
}

// =============================================
// L4 操作计划
// 轻仓：强烈关注≥75 / 可考虑≥70 / <70不操作
// =============================================
function layer4Plan(stock, market) {
  const { price, totalScore } = stock;
  let action='不操作', actionColor='muted', reason='';
  if (market.position === '满仓' || market.position === '重仓') {
    if (totalScore >= 70)      { action='强烈关注'; actionColor='green';  reason=`${totalScore}分`; }
    else if (totalScore >= 55) { action='可考虑';   actionColor='yellow'; reason=`${totalScore}分`; }
    else if (totalScore >= 45) { action='关注';     actionColor='muted';  reason=`${totalScore}分`; }
  } else if (market.position === '轻仓') {
    if (totalScore >= 75)       { action='强烈关注'; actionColor='green';  reason=`${totalScore}分`; }
    else if (totalScore >= 70) { action='可考虑';   actionColor='yellow'; reason=`${totalScore}分`; }
  } else {
    if (totalScore >= 80) { action='关注'; actionColor='muted'; reason=`${totalScore}分`; }
  }
  return { action, actionColor, reason };
}

// =============================================
// 渲染 — 指数（A股+美股）
// =============================================
function renderIndices(cnIndices, usIndices) {
  const container = $('indexList');
  const all = [
    ...cnIndices.map(i => ({ ...i, isUS: false })),
    ...usIndices.map(i => ({ ...i, isUS: true })),
  ];
  container.innerHTML = all.map(idx => {
    const up   = idx.change >= 0;
    const color = up ? 'var(--green)' : 'var(--red)';
    const sign  = up ? '+' : '';
    const actual = idx.price ? (idx.price > 10000
      ? idx.price.toLocaleString('zh-CN', { maximumFractionDigits: 0 })
      : idx.price.toFixed(2)) : '—';
    const barPct = Math.min(100, Math.abs(idx.change || 0) * 6 + 15);
    return `
    <div class="index-item ${idx.isUS ? 'index-us' : ''}">
      <div class="index-top">
        <span class="index-name">${idx.name}${idx.isUS ? ' 🌎' : ''}</span>
        <span class="index-actual" style="color:${color}">${actual}</span>
      </div>
      <div class="index-bottom">
        <div class="index-bar-wrap">
          <div class="index-bar" style="width:${barPct}%; background:${color}"></div>
        </div>
        <span class="index-score" style="color:${color}">${sign}${(idx.change||0).toFixed(2)}%</span>
      </div>
    </div>`;
  }).join('');
}

// =============================================
// 渲染 — 市场环境
// =============================================
function renderMarket(market) {
  const el = (id, val, color) => {
    const e = $(id);
    if (e) { e.textContent = val; e.style.color = color || 'var(--text)'; }
  };
  const betaColor = market.beta==='强势' ? 'var(--green)' : market.beta==='弱势' ? 'var(--red)' : 'var(--yellow)';
  el('beta',       market.beta,            betaColor);
  el('sentiment',  market.sentiment + '°', market.sentiment >= 50 ? 'var(--green)' : 'var(--red)');
  el('fitness',    market.fitness,         market.fitness >= 50 ? 'var(--green)' : 'var(--red)');
  el('position',   market.position,        market.position==='满仓'||market.position==='重仓' ? 'var(--green)' : 'var(--yellow)');
}

// =============================================
// 渲染 — 选股漏斗（4层，2×2布局）
// =============================================
const LAYER_STANDARDS = [
  `通过（满足任一）：涨幅>0.5% OR 量比>1.5 OR 股价>开盘\n排除：pct<-3% 且 vol<5万手（暴跌无量）`,
  `通过（同时满足）：\n①板块强势股≥2只(pct>1%) ②板块均涨>0.5%`,
  `关注指数 = 涨幅25%+量比25%+资金15%+板块35%\n门槛：totalScore≥60分`,
  `轻仓标准：强烈关注≥75 / 可考虑≥70 / <70不操作`,
];

function renderFunnel(stages) {
  const container = $('funnelStages');
  const labels = ['L1 信号扫描', 'L2 板块确认', 'L3 量化评分', 'L4 操作计划'];
  const barColors = ['#58a6ff', '#1f6feb', '#d29922', '#f85149'];

  container.innerHTML = stages.map((layer, i) => {
    const stocks = layer.stocks || [];
    const count  = layer.count ?? stocks.length;
    const total  = layer.total ?? count;
    const pct    = total > 0 ? Math.round(count / total * 100) : 0;

    const stdHtml = LAYER_STANDARDS[i].split('\n')
      .map(l => `<div class="std-line">${l}</div>`).join('');

    const rows = stocks.map(s => {
      const up    = s.pct >= 0;
      const color  = up ? 'var(--green)' : 'var(--red)';
      const sign   = up ? '+' : '';

      let scoreLabel = '', scoreColor = 'var(--muted)';
      if (i === 0) {
        scoreLabel = `${s.signal||0}分`;
        scoreColor = (s.signal||0) >= 30 ? 'var(--green)' : 'var(--muted)';
      } else if (i === 1) {
        scoreLabel = s.l2Reason || '—';
        scoreColor = 'var(--yellow)';
      } else if (i === 2) {
        scoreLabel = `${s.totalScore||0}分`;
        scoreColor = (s.totalScore||0) >= 75 ? 'var(--green)' : (s.totalScore||0) >= 60 ? 'var(--yellow)' : 'var(--muted)';
      } else {
        scoreLabel = s.plan?.action || '—';
        scoreColor = `var(--${s.plan?.actionColor||'muted'})`;
      }

      const paramHtml = i === 2 ? `
        <span class="param pct-param">涨${s.pctScore||0}</span>
        <span class="param vol-param">量${s.volScore||0}</span>
        <span class="param fund-param">资${s.fundScore||0}</span>
        <span class="param sector-param">板${s.sectorScore||0}</span>` : '';

      const reasonHtml = (i === 3 && s.plan?.reason) ? `<span class="action-reason">${s.plan.reason}</span>` : '';

      return `
      <div class="funnel-row">
        <span class="funnel-name" title="${s.code}">${s.name}</span>
        <span class="funnel-sector">${s.sector||'—'}</span>
        <span style="color:${color}">${sign}${(s.pct||0).toFixed(2)}%</span>
        ${paramHtml}
        <span class="funnel-score" style="color:${scoreColor}">
          <span class="main-label">${scoreLabel}</span>
          ${reasonHtml}
        </span>
      </div>`;
    }).join('');

    return `
    <div class="funnel-layer">
      <div class="funnel-header">
        <span class="funnel-title">${labels[i]}</span>
        <span class="funnel-count">${count}只${i>0 ? ` / 漏斗率${pct}%` : ` / 共${total}只`}</span>
      </div>
      <div class="layer-standards">${stdHtml}</div>
      <div class="funnel-bar-wrap">
        <div class="funnel-bar" style="width:${pct}%; background:${barColors[i]}"></div>
      </div>
      <div class="funnel-rows">${rows||'<div class="empty-state">无股票通过</div>'}</div>
    </div>`;
  }).join('');
}

// =============================================
// 渲染 — 持仓
// =============================================
function renderHoldings(dataMap) {
  const tbody = $('holdingsBody');
  const countEl = $('holdingCount');
  const rows = CONFIG.HOLDINGS.map(h => {
    const d = dataMap[h.code];
    if (!d) return null;
    const price    = d.price;
    const pnlPct  = (price - h.cost) / h.cost * 100;
    const pnlNum   = parseFloat(pnlPct.toFixed(2));
    const pClass  = pnlNum >= 0 ? 'positive' : 'negative';
    const sign     = pnlNum >= 0 ? '+' : '';
    const stopLine = (h.cost * 0.92).toFixed(2);
    const mktVal   = price * h.shares;
    const costVal  = h.cost * h.shares;
    const pnlVal   = mktVal - costVal;
    const status   = pnlNum <= -8 ? 'status-danger' : pnlNum <= -3 ? 'status-warning' : 'status-ok';
    const statusTxt = pnlNum <= -8 ? '⚠止损!' : pnlNum <= -3 ? '注意' : '正常';
    return `<tr>
      <td class="holding-name">${h.name}</td>
      <td>${h.code.replace(/^(sh|sz)/,'')}</td>
      <td>${h.sector}</td>
      <td>${h.cost.toFixed(2)}</td>
      <td>${price.toFixed(2)}</td>
      <td class="${pClass}">${sign}${pnlNum}%</td>
      <td class="${pClass}">${sign}${(price-h.cost).toFixed(2)}</td>
      <td>${stopLine}</td>
      <td class="${pClass}">${(pnlVal>=0?'+':'')+pnlVal.toFixed(0)}</td>
      <td class="${status}">${statusTxt}</td>
    </tr>`;
  }).filter(Boolean);
  countEl.textContent = rows.length ? `（${rows.length}只持仓）` : '';
  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="10" class="empty-state">暂无持仓</td></tr>';
}

// =============================================
// 主流程
// =============================================
let isRefreshing = false;

async function refreshData() {
  if (isRefreshing) return;
  isRefreshing = true;
  const btn = $('refreshBtn');
  btn.disabled = true;
  btn.textContent = '⏳ 刷新中...';
  log('═'.repeat(42), 'info');
  log('开始选股扫描 v4.2', 'info');

  try {
    const dataMap = await fetchAllData();

    // 指数
    const cnIndices = CONFIG.INDICES_CN.map(idx => {
      const d = dataMap[idx.code];
      return d ? { name: d.name||idx.name, change: d.change||0, price: d.price||0 } : { name: idx.name, change: 0, price: 0 };
    });
    const usIndices = CONFIG.INDICES_US.map(idx => {
      const d = dataMap[idx.code];
      if (!d) return null;
      const price  = d.price || 0;
      const yclose = d.yclose || price;
      const change  = yclose > 0 ? (price - yclose) / yclose * 100 : 0;
      return { name: idx.name, change, price, isUS: true };
    }).filter(Boolean);
    renderIndices(cnIndices, usIndices);

    const market = assessMarket(cnIndices);
    renderMarket(market);
    log(`市场：β=${market.beta} | 情绪=${market.sentiment}° | 适合度=${market.fitness} | ${market.position}`, 'info');

    if (usIndices.length) {
      log(`美股：${usIndices.map(i => `${i.name}${i.change>=0?'+':''}${i.change.toFixed(2)}%`).join(' | ')}`, 'info');
    }

    // 持仓
    renderHoldings(dataMap);

    // L1
    const allCodes = Object.values(CONFIG.SECTORS).flat();
    const l1 = allCodes.map(c => layer1Signal(c, dataMap)).filter(Boolean);
    log(`L1 信号扫描：${l1.length}/${allCodes.length} 只通过`, 'info');

    // L2
    const l2 = layer2Sector(l1);
    const l2pct = l1.length ? Math.round(l2.length/l1.length*100) : 0;
    log(`L2 板块确认：${l2.length} 只（漏斗率${l2pct}%）`, 'info');

    // L3
    const l3 = layer3Score(l2, dataMap);
    const l3pct = l2.length ? Math.round(l3.length/l2.length*100) : 0;
    log(`L3 量化评分：${l3.length} 只≥60分（漏斗率${l3pct}%）`, 'info');

    // L4
    const l4raw = l3.map(s => ({ ...s, plan: layer4Plan(s, market) }));
    const actionable = l4raw.filter(s => s.plan.action === '强烈关注' || s.plan.action === '可考虑');
    const l4pct = l3.length ? Math.round(actionable.length/l3.length*100) : 0;
    log(`L4 操作计划：${actionable.length} 只（漏斗率${l4pct}%）`, 'info');

    $('funnelSubtitle').textContent = `${l1.length}→${l2.length}→${l3.length}→${actionable.length}`;

    renderFunnel([
      { stocks: l1,          total: allCodes.length },
      { stocks: l2,          total: l1.length },
      { stocks: l3,          total: l2.length },
      { stocks: actionable,  total: l3.length },
    ]);

    const top = actionable.slice(0, 5);
    if (top.length) {
      log(`推荐：${top.map(s => `${s.name}(${s.plan.action} ${s.totalScore}分)`).join(' | ')}`, 'success');
    } else {
      log('无符合L4条件的股票，耐心等待机会', 'info');
    }

    $('lastUpdate').textContent = `最后更新: ${new Date().toLocaleString('zh-CN')}`;
  } catch (err) {
    log(`刷新失败: ${err.message}`, 'error');
    console.error(err);
  } finally {
    isRefreshing = false;
    btn.disabled = false;
    btn.textContent = '🔄 刷新数据';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  log('BBDA 选股系统 v4.2 就绪', 'success');
  log('点击「刷新数据」开始4层选股扫描...', 'normal');
});
