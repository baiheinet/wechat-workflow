#!/usr/bin/env node
const { getArticleTotal } = require('./lib/wechatApi');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { days: 7 };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--days' && args[i + 1]) opts.days = parseInt(args[++i], 10);
    else if (args[i] === '--start' && args[i + 1]) opts.start = args[++i];
    else if (args[i] === '--end' && args[i + 1]) opts.end = args[++i];
    else if (args[i] === '--help') opts.help = true;
  }
  return opts;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function calcDateRange(opts) {
  if (opts.start && opts.end) return { start: opts.start, end: opts.end };
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - opts.days);
  return { start: formatDate(start), end: formatDate(end) };
}

function fmt(n) {
  if (n === undefined || n === null) return '-';
  return n.toLocaleString('zh-CN');
}

function main() {
  const opts = parseArgs();
  if (opts.help) {
    console.log(`
Usage: node scripts/stats.js [options]

Options:
  --days <n>     Past N days (default: 7)
  --start YYYY-MM-DD  Start date (use with --end)
  --end YYYY-MM-DD    End date
  --help         Show this help

Examples:
  node scripts/stats.js
  node scripts/stats.js --days 30
  node scripts/stats.js --start 2026-06-01 --end 2026-06-06
`);
    process.exit(0);
  }

  const { start, end } = calcDateRange(opts);
  console.log(`\n📊 数据复盘 (${start} ~ ${end})\n`);

  getArticleTotal(start, end).then(data => {
    if (!data.list || data.list.length === 0) {
      console.log('当前时间段内没有文章数据。');
      process.exit(0);
    }
    let grandTotal = { int_page_read: 0, share_user: 0, add_to_fav: 0 };
    for (const day of data.list) {
      const refDate = day.ref_date;
      for (const item of day.details || []) {
        const title = item.title || '未知文章';
        console.log(`【${refDate}】${title}`);
        console.log(`  阅读人数: ${fmt(item.stat?.int_page_read_users)} | 阅读次数: ${fmt(item.stat?.int_page_read_count)}`);
        console.log(`  分享人数: ${fmt(item.stat?.share_user)}     | 分享次数: ${fmt(item.stat?.share_count)}`);
        console.log(`  收藏人数: ${fmt(item.stat?.add_to_fav_user)} | 收藏次数: ${fmt(item.stat?.add_to_fav_count)}`);
        console.log(`  原文阅读: ${fmt(item.stat?.ori_page_read_users)} | 留存率: ${item.stat?.stay_offline_percent ?? '-'}%`);
        console.log('');
        grandTotal.int_page_read += item.stat?.int_page_read_users || 0;
        grandTotal.share_user += item.stat?.share_user || 0;
        grandTotal.add_to_fav += item.stat?.add_to_fav_user || 0;
      }
    }
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`📈 合计 | 阅读: ${fmt(grandTotal.int_page_read)} | 分享: ${fmt(grandTotal.share_user)} | 收藏: ${fmt(grandTotal.add_to_fav)}`);
  }).catch(err => {
    console.error(`错误: ${err.message}`);
    process.exit(1);
  });
}

main();
