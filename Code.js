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

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
    
    // --- ステップ1: 現在のプロジェクト内容を取得する (GETリクエスト) ---
    const getOptions = {
      method: 'get',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      muteHttpExceptions: true
    };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    const getResponseCode = getResponse.getResponseCode();
    const getResponseBody = getResponse.getContentText();

    if (getResponseCode !== 200) {
      throw new Error(`スクリプト内容の取得に失敗しました。 Status: ${getResponseCode}. Response: ${getResponseBody}`);
    }
    const projectContent = JSON.parse(getResponseBody);

    // --- ステップ2: AIによる処理をシミュレーションし、コードを修正する ---
    // 本来はここでLLMを呼び出しますが、今回は「コード.gs」に新しい関数を追記する処理をハードコードします。
    const targetFile = projectContent.files.find(file => file.name === 'コード');
    if (!targetFile) {
      throw new Error('プロジェクトに "コード.gs" ファイルが見つかりません。');
    }

    // 古いソースコードに、新しい関数を追記する
    const newFunction = `\n\n// Methaneがプロンプト「${prompt}」を基に追加しました\nfunction helloFromMethane() {\n  Logger.log("Hello, World! この関数はMethane AI Agentによって追加されました。");\n}`;
    targetFile.source += newFunction;

    // --- ステップ3: 修正した内容でプロジェクト全体を更新する (PUTリクエスト) ---
    const putOptions = {
      method: 'put',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      contentType: 'application/json',
      payload: JSON.stringify(projectContent), // 修正したプロジェクト構造全体を送信する
      muteHttpExceptions: true
    };

    const putResponse = UrlFetchApp.fetch(contentUrl, putOptions);
    const putResponseCode = putResponse.getResponseCode();
    const putResponseBody = putResponse.getContentText();

    if (putResponseCode !== 200) {
      throw new Error(`スクリプトの更新に失敗しました。 Status: ${putResponseCode}. Response: ${putResponseBody}`);
    }

    console.log('スクリプトの更新に成功しました。');
    return `スクリプト (ID: ${scriptId}) の更新に成功しました。「コード.gs」に新しい関数 "helloFromMethane" を追加しました。`;

  } catch (e) {
    console.error(e);
    return `Error: ${e.message}`;
  }
}
