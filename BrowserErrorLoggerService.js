/**
 * クライアントサイド（ブラウザ）から送信されたエラー情報をCloud Loggingに記録します。
 * この関数はWebアプリケーションがデプロイされている場合にのみ利用可能です。
 *
 * @param {object} errorInfo - クライアントから送信されたエラー情報オブジェクト。
 * @param {string} errorInfo.type - エラーイベントのタイプ ('onerror' または 'unhandledrejection')。
 * @param {string} errorInfo.message - エラーメッセージ。
 * @param {string} [errorInfo.source] - エラーが発生したスクリプトのURL (onerrorのみ)。
 * @param {number} [errorInfo.lineno] - エラーが発生した行番号 (onerrorのみ)。
 * @param {number} [errorInfo.colno] - エラーが発生した列番号 (onerrorのみ)。
 * @param {string} [errorInfo.stack] - エラーのスタックトレース。
 */
function logClientError(errorInfo) {
  if (typeof errorInfo !== 'object' || errorInfo === null) {
    Logger.log('Received invalid errorInfo object from client: %s', errorInfo);
    return;
  }

  const logMessage = `Client-side Error (${errorInfo.type}):\n` +
                     `Message: ${errorInfo.message}\n` +
                     (errorInfo.source ? `Source: ${errorInfo.source}\n` : '') +
                     (errorInfo.lineno ? `Line: ${errorInfo.lineno}\n` : '') +
                     (errorInfo.colno ? `Column: ${errorInfo.colno}\n` : '') +
                     (errorInfo.stack ? `Stack: ${errorInfo.stack}\n` : 'No stack trace.');

  Logger.log(logMessage);
}
