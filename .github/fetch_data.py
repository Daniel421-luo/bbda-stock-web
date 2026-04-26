#!/usr/bin/env python3
"""
BBDA 板块数据抓取脚本
从东方财富获取 A 股板块数据
"""

import json
import re
import time
from datetime import datetime

import requests

def get_sector_data():
    """获取板块数据"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': 'https://quote.eastmoney.com/center/boardlist.html'
    }

    params = {
        'pn': 1,
        'pz': 50,
        'po': 1,
        'np': 1,
        'ut': 'bd1d9ddb04089700cf9c27f6f7426281',
        'fltt': 2,
        'invt': 2,
        'fid': 'f3',
        'fs': 'M:90+A',
        'fields': 'f1,f2,f3,f4,f5,f6,f7,f8,f9,f10,f12,f13,f14,f20',
    }

    try:
        response = requests.get("https://push2.eastmoney.com/api/qt/clist/get", params=params, headers=headers, timeout=10)
        data = response.json()
        sectors = []
        if data.get('data') and data['data'].get('diff'):
            for item in data['data']['diff'][:30]:
                sectors.append({
                    'name': item.get('f14', ''),
                    'change': item.get('f3', 0),
                    'turnover': item.get('f5', 0),
                    'leading_stock': '',
                })
        return sectors
    except Exception as e:
        print(f"获取数据失败: {e}")
        return []

def get_limit_up_count():
    """获取涨停数量"""
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
    params = {
        'pn': 1,
        'pz': 1,
        'po': 1,
        'np': 1,
        'ut': 'bd1d9ddb04089700cf9c27f6f7426281',
        'fltt': 2,
        'invt': 2,
        'fid': 'f3',
        'fs': 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23,m:0+t:81+s:2048',
        'fields': 'f1,f2,f3',
    }
    try:
        response = requests.get("https://push2.eastmoney.com/api/qt/clist/get", params=params, headers=headers, timeout=10)
        data = response.json()
        return data.get('data', {}).get('total', 0)
    except:
        return 0

def get_market_summary():
    """获取指数数据"""
    headers = {'User-Agent': 'Mozilla/5.0'}
    indices = {
        'sh000001': '上证指数',
        'sz399001': '深证成指',
        'sz399006': '创业板指',
        'sh000300': '沪深300',
        'sh000852': '中证1000',
    }
    result = {}
    for code, name in indices.items():
        try:
            response = requests.get(f"https://qt.gtimg.cn/q={code}", headers=headers, timeout=5)
            match = re.search(r'"([^"]+)"', response.text)
            if match:
                parts = match.group(1).split('~')
                if len(parts) > 32:
                    result[code] = {
                        'name': name,
                        'price': float(parts[3]) if parts[3] else 0,
                        'change': float(parts[32]) if parts[32] else 0
                    }
            time.sleep(0.2)
        except:
            result[code] = {'name': name, 'price': 0, 'change': 0}
    return result

def main():
    print("开始抓取板块数据...")
    sectors = get_sector_data()
    limit_up_count = get_limit_up_count()
    indices = get_market_summary()

    data = {
        'update_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'indices': indices,
        'sectors': {
            'rise_top': sectors[:10],
            'turnover_top': sorted(sectors, key=lambda x: x.get('turnover', 0), reverse=True)[:10],
        },
        'market': {
            'limit_up_count': limit_up_count,
            'rising_count': len([s for s in sectors if s.get('change', 0) > 0]),
            'falling_count': len([s for s in sectors if s.get('change', 0) < 0]),
        }
    }

    with open('data/sector.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"数据已保存! 更新时间: {data['update_time']}")
    print(f"上涨板块: {data['market']['rising_count']}, 涨停: {limit_up_count}")

if __name__ == '__main__':
    main()
