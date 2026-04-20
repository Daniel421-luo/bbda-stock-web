/**
 * BBDA 选股系统 - app.js
 * v1.0
 * 数据来源：Yahoo Finance (浏览器直接调用)
 */

const CONFIG = {
  // Yahoo Finance API endpoint
  YF_BASE: 'https://query1.finance.yahoo.com/v8/finance/chart/',
  // CORS 代理（解决浏览器跨域问题）
  CORS_PROXY: 'https://api.allorigins.win/raw?url=',
  // 主要指数（Yahoo代码格式）
  INDICES: [
    { code: '000001.SS', name: '上证指数', key: 'sh000001' },
    { code: '399001.SZ', name: '深证成指', key: 'sz399001' },
    { code: '399006.SZ', name: '创业板指', key: 'sz399006' },
    { code: '000300.SS', name: '沪深300',  key: 'sh000300' },
  ],
  // 扫描范围：各主要板块代表性股票
  SCAN_POOL: [
    '600519.SS', // 贵州茅台
    '000858.SZ', // 五粮液
    '601318.SS', // 中国平安
    '600036.SS', // 招商银行
    '000333.SZ', // 美的集团
    '300750.SZ', // 宁德时代
    '002475.SZ', // 立讯精密
    '600276.SS', // 恒瑞医药
    '002594.SZ', // 比亚迪
    '300059.SZ', // 东方财富
    '600900.SS', // 长江电力
    '601888.SS', // 中国中免
    '002415.SZ', // 海康威视
    '000002.SZ', // 万科A
    '600030.SS', // 中信证券
    '300015.SZ', // 爱尔眼科
    '600009.SS', // 上海机场
    '002352.SZ', // 顺丰控股
    '300760.SZ', // 迈瑞医疗
    '601012.SS', // 隆基绿能
  ],
  // 止损线
  STOP_LOSS: -0.08,
  // 持仓示例（正式版改为从 LocalStorage 或 API 读取）
  HOLDINGS: [
    { name: '宁德时代', code: '300750.SZ', cost: 185.0 },
    { name: '东方财富', code: '300059.SZ', cost: 18.50 },
    { name: '比亚迪',   code: '002594.SZ', cost: 245.0 },
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

async function fetchWithTimeout(url, ms = 30000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r;
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

function pctChange(current, previous) {
  if (!previous || previous === 0) return 0;
  return (current - previous) / previous;
}

// =============================================
// 数据获取
// =============================================

async function fetchIndexData() {
  log('正在获取指数数据...', 'info');
  const promises = CONFIG.INDICES.map(async (idx) => {
    const url = CONFIG.CORS_PROXY + `${CONFIG.YF_BASE}${idx.code}?interval=1d&range=5d`;
    const r = await fetchWithTimeout(url);
    const json = await r.json();
    const result = json?.chart?.result?.[0];
    if (!result) return { key: idx.key, name: idx.name, score: 0, price: 0, change: 0 };
    const meta = result.meta;
    const quotes = result.indicators?.quote?.[0]?.close || [];
    const validQuotes = quotes.filter(v => v !== null);
    const current = validQuotes[validQuotes.length - 1] || 0;
    const prev = validQuotes.length >= 2 ? validQuotes[validQuotes.length - 2] : current;
    const change = pctChange(current, prev);
    // 简单评分：涨幅×40 + 量比×30 + 趋势×30
    const trend = validQuotes.length >= 3
      ? (validQuotes[validQuotes.length-1] - validQuotes[validQuotes.length-3]) / validQuotes[validQuotes.length-3]
      : 0;
    const score = Math.min(100, Math.max(0,
      (change * 100 * 4) + (Math.abs(change) > 0.01 ? 30 : 0) + (trend * 100 * 3)
    ));
    return { key: idx.key, name: idx.name, score: Math.round(score), price: current, change };
  });
  return Promise.all(promises);
}

async function fetchStockData(codes) {
  log(`正在扫描 ${codes.length} 只股票...`, 'info');
  const results = [];
  // 分批请求避免并发过高
  const BATCH = 5;
  for (let i = 0; i < codes.length; i += BATCH) {
    const batch = codes.slice(i, i + BATCH);
    const promises = batch.map(async (code) => {
      try {
        const url = CONFIG.CORS_PROXY + `${CONFIG.YF_BASE}${code}?interval=1d&range=10d`;
        const r = await fetchWithTimeout(url);
        const json = await r.json();
        const result = json?.chart?.result?.[0];
        if (!result) return null;
        const quotes = (result.indicators?.quote?.[0]?.close || []).filter(v => v !== null);
        if (quotes.length < 3) return null;
        const current = quotes[quotes.length - 1];
        const ma5 = quotes.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, quotes.length);
        const ma10 = quotes.reduce((a, b) => a + b, 0) / quotes.length;
        const change = pctChange(current, quotes[quotes.length - 2]);
        const volume = result.indicators?.quote?.[0]?.volume || [];
        const avgVol = volume.filter(v => v !== null).slice(-5).reduce((a, b) => a + b, 0) / 5;
        const lastVol = volume[volume.length - 1] || 0;
        const volRatio = avgVol > 0 ? lastVol / avgVol : 0;
        // 选股信号评分
        let signal = 0;
        if (change > 0.02 && change < 0.09) signal += 40;         // 涨幅 2-9%
        if (current > ma5 && ma5 > ma10) signal += 30;             // 均线多头
        if (volRatio > 1.3) signal += 20;                          // 放量
        if (change > 0.01 && volRatio > 1.5) signal += 10;         // 温和放量上涨
        const changePct = (change * 100).toFixed(2);
        return {
          code: code.replace('.SS', '').replace('.SZ', ''),
          name: result.meta?.symbol || code,
          sector: getSector(code),
          price: current,
          change: parseFloat(changePct),
          score: signal,
          ma5: ma5.toFixed(2),
          volRatio: volRatio.toFixed(2),
        };
      } catch (e) {
        return null;
      }
    });
    const batchResults = await Promise.all(promises);
    results.push(...batchResults.filter(r => r !== null));
    log(`  已扫描 ${Math.min(i + BATCH, codes.length)}/${codes.length}`, 'normal');
  }
  return results;
}

function getSector(code) {
  // 简化：根据代码区间判断板块
  const sectorMap = {
    '600': '白酒', '601': '金融', '603': '科技', '605': '消费',
    '000': '家电/综合', '001': '地产', '002': '制造/科技',
    '300': '创业板/科技',
  };
  const prefix = code.slice(0, 3);
  return sectorMap[prefix] || '综合';
}

// =============================================
// 市场环境评估
// =============================================

function assessMarket(indices) {
  if (!indices.length) return { beta: 0, sentiment: 0, fitness: 0, position: '观望' };

  // 大盘β：平均涨幅
  const avgChange = indices.reduce((s, i) => s + (i.change || 0), 0) / indices.length;
  const beta = avgChange > 0.005 ? '强势' : avgChange < -0.005 ? '弱势' : '中性';

  // 情绪温度：综合评分归一化
  const avgScore = indices.reduce((s, i) => s + (i.score || 0), 0) / indices.length;
  const sentiment = Math.round(avgScore);

  // 适合度评分
  let fitness = 50;
  if (avgChange > 0.01) fitness += 20;
  if (avgChange < -0.01) fitness -= 20;
  if (sentiment > 60) fitness += 15;
  if (sentiment < 40) fitness -= 15;
  fitness = Math.min(100, Math.max(0, fitness));

  // 仓位建议
  let position = '轻仓';
  if (beta === '强势' && fitness > 65) position = '满仓';
  else if (beta === '强势' && fitness > 50) position = '重仓';
  else if (beta === '弱势' && fitness < 40) position = '空仓';
  else if (avgChange < -0.02) position = '减仓';

  return { beta, sentiment, fitness, position };
}

// =============================================
// 渲染
// =============================================

function renderIndices(indices) {
  let totalScore = 0;
  indices.forEach((idx, i) => {
    const barId = `bar_${idx.key}`;
    const scoreId = `score_${idx.key}`;
    const barEl = $(barId);
    const scoreEl = $(scoreId);
    if (barEl) barEl.style.width = `${idx.score}%`;
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
  el('beta', market.beta, market.beta === '强势' ? 'var(--green)' : market.beta === '弱势' ? 'var(--red)' : 'var(--yellow)');
  el('sentiment', market.sentiment + '°', market.sentiment >= 50 ? 'var(--green)' : 'var(--red)');
  el('fitness', market.fitness, market.fitness >= 50 ? 'var(--green)' : 'var(--red)');
  el('position', market.position, market.position === '满仓' || market.position === '重仓' ? 'var(--green)' : 'var(--yellow)');
}

function renderStockList(stocks) {
  const container = $('stockList');
  if (!stocks || !stocks.length) {
    container.innerHTML = '<div class="empty-state">今日扫描：无符合条件股票</div>';
    return;
  }
  // 按评分排序，取前10
  const top = stocks.sort((a, b) => b.score - a.score).slice(0, 10);
  container.innerHTML = top.map(s => `
    <div class="stock-item" title="评分: ${s.score} | 涨幅: ${s.change}% | 量比: ${s.volRatio}">
      <div>
        <div class="stock-name">${s.name}</div>
        <div class="stock-code">${s.code} · ${s.sector}</div>
      </div>
      <div class="stock-sector">${s.change > 0 ? '+' : ''}${s.change}%</div>
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
  // 取评分最高的几只作为"推荐持仓"示例
  const top = stocks.sort((a, b) => b.score - a.score).slice(0, 5);
  const holdingMap = {};
  CONFIG.HOLDINGS.forEach(h => { holdingMap[h.code] = h; });

  tbody.innerHTML = top.map(s => {
    const codeFull = s.code + (s.code.startsWith('6') ? '.SS' : '.SZ');
    const holding = holdingMap[codeFull] || null;
    if (!holding) return '';
    const pnl = holding.cost > 0 ? ((s.price - holding.cost) / holding.cost * 100).toFixed(2) : 0;
    const pnlClass = pnl >= 0 ? 'positive' : 'negative';
    const stopLine = (holding.cost * 0.92).toFixed(2);
    const status = pnl <= -8 ? 'status-danger' : pnl <= -3 ? 'status-warning' : 'status-ok';
    const statusText = pnl <= -8 ? '⚠ 止损!' : pnl <= -3 ? '注意' : '正常';
    return `
      <tr>
        <td>${s.name}</td>
        <td>${s.code}</td>
        <td>${holding.cost.toFixed(2)}</td>
        <td>${s.price.toFixed(2)}</td>
        <td class="${pnlClass}">${pnl >= 0 ? '+' : ''}${pnl}%</td>
        <td>${stopLine}</td>
        <td class="${status}">${statusText}</td>
      </tr>
    `;
  }).join('');

  if (tbody.innerHTML === '') {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">持仓股票暂无行情数据</td></tr>';
  }
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
    // Step 1: 获取指数
    const indices = await fetchIndexData();
    renderIndices(indices);

    // Step 2: 市场环境评估
    const market = assessMarket(indices);
    renderMarketOverview(market);
    log(`市场评估：β=${market.beta} | 情绪=${market.sentiment}° | 适合度=${market.fitness} | 建议=${market.position}`, 'info');

    // Step 3: 扫描选股
    const stocks = await fetchStockData(CONFIG.SCAN_POOL);
    renderStockList(stocks);
    renderHoldings(stocks);

    const validStocks = stocks.filter(s => s.score >= 50);
    log(`扫描完成：${stocks.length} 只股票，${validStocks.length} 只通过初筛`, validStocks.length > 0 ? 'success' : 'normal');

    // Step 4: 更新时间
    const now = new Date().toLocaleString('zh-CN');
    $('lastUpdate').textContent = `最后更新: ${now}`;

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
