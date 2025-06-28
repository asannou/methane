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
    // Apps Script APIを呼び出すための準備
    const accessToken = ScriptApp.getOAuthToken();
    const url = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
    
    const options = {
      method: 'get',
      headers: {
        'Authorization': `Bearer ${accessToken}`
      },
      muteHttpExceptions: true // APIエラーを例外としてスローさせず、レスポンスとして受け取る
    };

    // Apps Script APIを呼び出して、プロジェクトの内容を取得
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      console.error(`API Error: ${responseBody}`);
      throw new Error(`Failed to fetch script content. Status: ${responseCode}. Response: ${responseBody}`);
    }

    const content = JSON.parse(responseBody);
    
    // 取得したファイルの内容を整形して文字列にする
    let filesContent = `--- Project Files for Script ID: ${scriptId} ---\n\n`;
    content.files.forEach(file => {
      filesContent += `--- File: ${file.name} (${file.type}) ---\n`;
      filesContent += `${file.source}\n\n`;
    });

    // TODO: ここでfilesContentとpromptをLLMに渡して新しいコードを生成する

    // 現時点では、取得したファイルの内容をそのまま返す
    return filesContent;

  } catch (e) {
    console.error(e);
    return `Error: ${e.message}`;
  }
}
