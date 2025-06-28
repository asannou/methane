function doGet() {
  // index.htmlという名前のHTMLファイルを読み込み、Webページとして表示する
  return HtmlService.createHtmlOutputFromFile('index')
      .setTitle('Methane AI Agent');
}

/**
 * UIからプロンプトを受け取り、処理を実行する関数
 * @param {object} formObject - UIのフォームから送られてくるデータ
 * @returns {string} - 処理結果の文字列
 */
function processPrompt(formObject) {
  const scriptId = formObject.scriptId;
  const prompt = formObject.prompt;

  console.log(`対象スクリプトID: ${scriptId}`);
  console.log(`プロンプト: ${prompt}`);

  // TODO: ここにApps Script APIを呼び出す処理を実装する

  // 一旦、受け取った内容をそのまま返す
  const result = `以下の内容を受け取りました。\nScript ID: ${scriptId}\nPrompt: ${prompt}`;
  return result;
}
