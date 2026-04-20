/**
 * BBDA 选股系统 - app.js
 * v2.0
 * 数据来源：腾讯财经（国内直连，无CORS问题）
 */

const CONFIG = {
  // 腾讯财经API
  TENCENT_BASE: 'https://qt.gtimg.cn/q=',
  // 主要指数
  INDICES: [
    { code: 'sh000001', name: '上证指数',   key: 'sh000001' },
    { code: 'sz399001', name: '深证成指',   key: 'sz399001' },
    { code: 'sz399006', name: '创业板指',   key: 'sz399006' },
    { code: 'sh000300', name: '沪深300',    key: 'sh000300' },
  ],
  // 扫描范围：各主要板块代表性股票
  SCAN_POOL: [
    'sh600519', // 贵州茅台
    'sz000858', // 五粮液
    'sh601318', // 中国平安
    'sh600036', // 招商银行
    'sz000333', // 美的集团
    'sz300750', // 宁德时代
    'sz002475', // 立讯精密
    'sh600276', // 恒瑞医药
    'sz002594', // 比亚迪
    'sz300059', // 东方财富
    'sh600900', // 长江电力
    'sh601888', // 中国中免
    'sz002415', // 海康威视
    'sz000002', // 万科A
    'sh600030', // 中信证券
    'sz300015', // 爱尔眼科
    'sh600009', // 上海机场
    'sz002352', // 顺丰控股
    'sz300760', // 迈瑞医疗
    'sh601012', // 隆基绿能
  ],
  // 止损线
  STOP_LOSS: -0.08,
  // 持仓示例
  HOLDINGS: [
    { name: '宁德时代', code: 'sz300750', cost: 185.0 },
    { name: '东方财富', code: 'sz300059', cost: 18.50 },
    { name: '比亚迪',   code: 'sz002594', cost: 245.0 },
  ],
};

// =============================================
// 工具函数
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

function pctChange(current, previous) {
  if (!previous || previous === 0) return 0;
  return (current - previous) / previous;
}

// 解析腾讯财经数据
// 格式: v_sh000001="1~name~code~price~yesterday_close~open~vol~..."
function parseTencentData(raw) {
  try {
    // 去掉 var xxx="..." 包层
    const match = raw.match(/="([^"]+)"/);
    if (!match) return null;
    const fields = match[1].split('~');
    return {
      name:     fields[1]  || '',
      code:     fields[2]  || '',
      price:    parseFloat(fields[3])  || 0,
      yclose:   parseFloat(fields[4])  || 0,
      open:     parseFloat(fields[5])  || 0,
      vol:      parseFloat(fields[6])  || 0,   // 成交量（手）
      b1:       parseFloat(fields[9])  || 0,   // 买一价
      s1:       parseFloat(fields[19]) || 0,   // 卖一价
      date:     fields[30] || '',
      time:     fields[31] || '',
      change:   parseFloat(fields[32]) || 0,   // 涨跌额
      changePct:parseFloat(fields[33]) || 0,  // 涨跌幅%
    };
  } catch (e) {
    return null;
  }
}

// =============================================
// 数据获取
// =============================================

async function fetchTencent(codes) {
  const url = CONFIG.TENCENT_BASE + codes.join(',');
  const r = await fetch(url);
  const text = await r.text();
  const lines = text.trim().split('\n');
  const results = [];
  lines.forEach((line, i) => {
    const data = parseTencentData(line);
    if (data && data.code) results.push({ ...data, _idx: i });
  });
  return results;
}

async function fetchIndexData() {
  log('正在获取指数数据...', 'info');
  const codes = CONFIG.INDICES.map(i => i.code);
  const allData = await fetchTencent(codes);
  return CONFIG.INDICES.map(idx => {
    const d = allData.find(x => x.code === idx.code);
    if (!d) return { key: idx.key, name: idx.name, score: 0, price: 0, change: 0 };
    const changePct = d.changePct;
    // 评分逻辑：涨幅×4 + 趋势分×3
    const score = Math.min(100, Math.max(0, Math.round((changePct + 2) * 25 + Math.abs(changePct) * 20)));
    return { key: idx.key, name: idx.name, score, price: d.price, change: changePct };
  });
}

async function fetchStockData() {
  log(`正在扫描 ${CONFIG.SCAN_POOL.length} 只股票...`, 'info');
  const allData = await fetchTencent(CONFIG.SCAN_POOL);
  return allData.map(d => {
    const changePct = d.changePct;
    // 选股信号评分
    let signal = 0;
    if (changePct > 1.5 && changePct < 9) signal += 40;   // 涨幅1.5-9%
    if (d.price > d.yclose) signal += 30;                   // 股价上涨
    if (d.vol > 500000) signal += 20;                       // 成交量放大（>50万手）
    if (changePct > 0.5 && d.change > 0) signal += 10;     // 温和上涨
    return {
      code:     d.code.replace(/^(sh|sz)/, ''),
      name:     d.name,
      price:    d.price,
      change:   changePct,
      score:    signal,
      vol:      d.vol,
      codeFull: d.code,
    };
  });
}

// =============================================
// 市场环境评估
// =============================================

function assessMarket(indices) {
  if (!indices.length) return { beta: '未知', sentiment: 0, fitness: 50, position: '观望' };
  const avgChange = indices.reduce((s, i) => s + (i.change || 0), 0) / indices.length;
  const avgScore  = indices.reduce((s, i) => s + (i.score || 0), 0) / indices.length;
  const beta      = avgChange > 0.5  ? '强势' : avgChange < -0.5 ? '弱势' : '中性';
  const sentiment = Math.round(avgScore);
  let fitness = 50 + (avgChange > 0.5 ? 20 : avgChange < -0.5 ? -20 : 0);
  fitness = Math.min(100, Math.max(0, fitness));
  let position = '轻仓';
  if (beta === '强势' && fitness > 65) position = '满仓';
  else if (beta === '强势' && fitness > 50) position = '重仓';
  else if (beta === '弱势' && fitness < 40) position = '空仓';
  else if (avgChange < -1) position = '减仓';
  return { beta, sentiment, fitness, position };
}

// =============================================
// 渲染
// =============================================

function renderIndices(indices) {
  let totalScore = 0;
  indices.forEach(idx => {
    const barEl   = $(`bar_${idx.key}`);
    const scoreEl = $(`score_${idx.key}`);
    if (barEl)   barEl.style.width = `${idx.score}%`;
    if (scoreEl) {
      scoreEl.textContent = idx.score;
      scoreEl.style.color = idx.change >= 0 ? 'var(--green)' : 'var(--red)';
    }
    totalScore += idx.score;
  });
  const avgScore = indices.length ? Math.round(totalScore / indices.length) : 0;
  const totalEl = $('totalScore');
  if (totalEl) {
    totalEl.textContent = avgScore;
    totalEl.style.color = avgScore >= 50 ? 'var(--blue)' : 'var(--muted)';
  }
}

function renderMarketOverview(market) {
  const el = (id, val, color) => {
    const e = $(id);
    if (e) { e.textContent = val; e.style.color = color || 'var(--text)'; }
  };
  const betaColor = market.beta === '强势' ? 'var(--green)' : market.beta === '弱势' ? 'var(--red)' : 'var(--yellow)';
  el('beta',      market.beta,     betaColor);
  el('sentiment', market.sentiment + '°', market.sentiment >= 50 ? 'var(--green)' : 'var(--red)');
  el('fitness',   market.fitness,  market.fitness >= 50 ? 'var(--green)' : 'var(--red)');
  el('position',  market.position,  market.position === '满仓' || market.position === '重仓' ? 'var(--green)' : 'var(--yellow)');
}

function renderStockList(stocks) {
  const container = $('stockList');
  if (!stocks || !stocks.length) {
    container.innerHTML = '<div class="empty-state">今日扫描：无符合条件股票</div>';
    return;
  }
  const top = stocks.sort((a, b) => b.score - a.score).slice(0, 10);
  container.innerHTML = top.map(s => `
    <div class="stock-item">
      <div>
        <div class="stock-name">${s.name}</div>
        <div class="stock-code">${s.code}</div>
      </div>
      <div class="stock-sector" style="color:${s.change>=0?'var(--green)':'var(--red)'}">
        ${s.change >= 0 ? '+' : ''}${s.change.toFixed(2)}%
      </div>
      <div class="stock-score">${s.score}分</div>
    </div>
  `).join('');
}

function renderHoldings(stocks) {
  const tbody = $('holdingsBody');
  if (!stocks || !stocks.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">暂无持仓数据</td></tr>';
    return;
  }
  const holdingMap = {};
  CONFIG.HOLDINGS.forEach(h => { holdingMap[h.code] = h; });

  const rows = stocks.filter(s => holdingMap[s.codeFull]).map(s => {
    const h = holdingMap[s.codeFull];
    const pnl = ((s.price - h.cost) / h.cost * 100).toFixed(2);
    const pnlNum = parseFloat(pnl);
    const pnlClass = pnlNum >= 0 ? 'positive' : 'negative';
    const stopLine = (h.cost * 0.92).toFixed(2);
    const status = pnlNum <= -8 ? 'status-danger' : pnlNum <= -3 ? 'status-warning' : 'status-ok';
    const statusText = pnlNum <= -8 ? '⚠ 止损!' : pnlNum <= -3 ? '注意' : '正常';
    return `<tr>
      <td>${s.name}</td>
      <td>${s.code}</td>
      <td>${h.cost.toFixed(2)}</td>
      <td>${s.price.toFixed(2)}</td>
      <td class="${pnlClass}">${pnlNum >= 0 ? '+' : ''}${pnl}%</td>
      <td>${stopLine}</td>
      <td class="${status}">${statusText}</td>
    </tr>`;
  });

  tbody.innerHTML = rows.length ? rows.join('') : '<tr><td colspan="7" class="empty-state">持仓股票暂无行情</td></tr>';
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
  log('='.repeat(40));
  log('开始刷新数据', 'info');
  try {
    const [indices, stocks] = await Promise.all([fetchIndexData(), fetchStockData()]);
    renderIndices(indices);
    const market = assessMarket(indices);
    renderMarketOverview(market);
    log(`市场：β=${market.beta} | 情绪=${market.sentiment}° | 适合度=${market.fitness} | 建议=${market.position}`, 'info');
    renderStockList(stocks);
    renderHoldings(stocks);
    const validStocks = stocks.filter(s => s.score >= 50);
    log(`扫描完成：${stocks.length} 只，${validStocks.length} 只通过初筛`, validStocks.length > 0 ? 'success' : 'normal');
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

// =============================================
// 初始化
// =============================================

document.addEventListener('DOMContentLoaded', () => {
  log('系统初始化完成', 'success');
  log('点击「刷新数据」开始选股扫描...', 'normal');
});
