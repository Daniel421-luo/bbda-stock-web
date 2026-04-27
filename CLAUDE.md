# BBDA 股票分析工具

## 项目概述
- **网站**: https://bbda6688.com
- **GitHub**: https://github.com/Daniel421-luo/bbda-stock-web.git
- **用途**: 输入股票代码，展示六层漏斗选股系统 v4.2 分析结果

## 技术栈
- 纯 HTML 单文件（无需构建）
- Tailwind CSS CDN
- Font Awesome 图标
- Netlify + GitHub Pages 部署

## 关键文件
| 文件 | 说明 |
|------|------|
| `index.html` | 主页面，包含完整的六层漏斗评分系统 |
| `.github/fetch_data.py` | Python 脚本，从东方财富 API 获取板块数据 |
| `.github/workflows/update_sector_data.yml` | GitHub Actions 配置，自动更新板块数据 |

## 六层漏斗评分系统

每个维度 0-5 分，最高 30 分：

| 维度 | 说明 |
|------|------|
| RPS 强度 | 相对强度指标 |
| 龙妖股状态 | 龙头/妖股识别 |
| 量价配合 | 成交量与价格配合度 |
| 流通市值 | 适中的流通市值 |
| 催化剂事件 | 近期利好/事件驱动 |
| 筹码分布 | 筹码集中度分析 |

另有市场环境评估 6 分、风险惩罚扣分。

## GitHub Actions 自动任务
- **触发时间**: 北京时间 11:05 和 15:05
- **任务**: 自动更新板块数据

## 工作流程
1. 修改 `index.html` 或其他文件
2. 提交到 GitHub: `git add . && git commit -m "描述" && git push`
3. Netlify 自动部署，几分钟后生效

## 常用命令
```bash
cd ~/projects/stock-web
git add .
git commit -m "描述"
git push
```

## 注意事项
- 网络不稳定时先检查连接再 push
- 如果 push 被拒绝（fetch first），先执行 `git pull --rebase`
