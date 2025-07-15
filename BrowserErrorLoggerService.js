/**
 * クライアントサイド（ブラウザ）から送信されたログ情報をCloud Loggingに記録します。
 * この関数はWebアプリケーションがデプロイされている場合にのみ利用可能です。
 *
 * @param {object} logInfo - クライアントから送信されたログ情報オブジェクト。
 * @param {string} logInfo.logLevel - ログのレベル ('ERROR' または 'WARNING')。
 * @param {string} logInfo.type - イベントのタイプ ('onerror', 'unhandledrejection', 'console.warn')。
 * @param {string} logInfo.message - メッセージ。
 * @param {string} [logInfo.source] - ソースURL (onerrorのみ)。
 * @param {number} [logInfo.lineno] - 行番号 (onerrorのみ)。
 * @param {number} [logInfo.colno] - 列番号 (onerrorのみ)。
 * @param {string} [logInfo.stack] - スタックトレース。
 */
function logClientError(logInfo) {
  if (typeof logInfo !== 'object' || logInfo === null) {
    // Use console.log or Logger.log for this internal warning, as it's not a client-side error/warning
    console.warn('Received invalid logInfo object from client: %s', logInfo);
    return;
  }

  const messagePrefix = logInfo.logLevel === 'WARNING' ? 'Client-side Warning' : 'Client-side Error';
  const logMessage = `${messagePrefix} (${logInfo.type}):\n` +
                     `Message: ${logInfo.message}\n` +
                     (logInfo.source ? `Source: ${logInfo.source}\n` : '') +
                     (logInfo.lineno ? `Line: ${logInfo.lineno}\n` : '') +
                     (logInfo.colno ? `Column: ${logInfo.colno}\n` : '') +
                     (logInfo.stack ? `Stack: ${logInfo.stack}\n` : 'No stack trace.');

  if (logInfo.logLevel === 'WARNING') {
    console.warn(logMessage); // Logs as WARNING in Cloud Logging
  } else if (logInfo.logLevel === 'ERROR') {
    console.error(logMessage); // Logs as ERROR in Cloud Logging
  } else {
    // Default to INFO for unexpected log levels
    console.log(`Client-side Log (${logInfo.type} - Unknown Level ${logInfo.logLevel}):\n` + logMessage);
  }
}