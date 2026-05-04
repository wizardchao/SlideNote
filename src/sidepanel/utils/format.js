/**
 * 格式化时间戳为相对时间
 * @param {number} timestamp 时间戳（毫秒）
 * @returns {string} 相对时间字符串
 */
export function formatRelativeTime(timestamp) {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60000);

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

/**
 * 格式化时间戳为本地日期时间
 * @param {number} timestamp 时间戳（毫秒）
 * @returns {string} 日期时间字符串
 */
export function formatDateTime(timestamp) {
  if (!timestamp) return '';

  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp);
}

/**
 * 截断文本
 * @param {string} text 原文本
 * @param {number} maxLength 最大长度
 * @returns {string} 截断后的文本
 */
export function truncateText(text, maxLength = 30) {
  if (!text) return '无内容';
  // 移除换行，取前 N 字
  return text.replace(/\n/g, ' ').slice(0, maxLength) || '无内容';
}
