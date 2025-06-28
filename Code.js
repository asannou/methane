function doGet() {
  return HtmlService.createHtmlOutputFromFile('index').setTitle('Methane AI Agent');
}

/**
 * AIモデル（シミュレーション）を呼び出す関数
 * @param {string} userPrompt - ユーザーが入力したプロンプト
 * @param {object} projectContent - 対象プロジェクトの全ファイル情報
 * @returns {object} - AIからのレスポンスを模したオブジェクト
 */
function callGenerativeAI(userPrompt, projectContent) {
  // AIに渡すための詳細な指示書（システムプロンプト）を作成する
  let systemPrompt = "あなたはGoogle Apps Scriptの専門家です。以下のファイル群とユーザーの指示を基に、修正後のファイル内容を生成してください。\n\n";
  systemPrompt += "## 既存のファイル一覧\n";
  projectContent.files.forEach(file => {
    systemPrompt += `### ファイル名: ${file.name}.${file.type === 'SERVER_JS' ? 'gs' : 'html'}\n`;
    systemPrompt += "```\n" + file.source + "\n```\n\n";
  });
  systemPrompt += `## ユーザーの指示\n${userPrompt}\n\n`;
  systemPrompt += "## あなたのタスク\n上記の指示に従って、変更が必要なファイルの新しいソースコードをJSON形式で返してください。変更しないファイルは含めないでください。\n例: {\"files\": [{\"name\": \"コード\", \"source\": \"...新しいソース...\"}]}";

  console.log("AIへの指示書:\n" + systemPrompt);

  // --- ここからAI呼び出しのシミュレーション ---
  // 本来は UrlFetchApp で Gemini API を呼び出す
  
  // 今回は、ユーザープロンプトに関わらず、「スプレッドシートのA1セルに現在時刻を書き込む関数」を返すように固定する
  const aiResponseJson = {
    "files": [
      {
        "name": "コード",
        "source": `function myFunction() {\n  \n}\n\n// Methaneがプロンプト「${userPrompt}」を基に追加しました\nfunction recordCurrentTime() {\n  SpreadsheetApp.getActiveSpreadsheet().getActiveSheet().getRange(\"A1\").setValue(new Date());\n}`
      }
    ]
  };
  
  console.log("AIからの応答（シミュレーション）:\n" + JSON.stringify(aiResponseJson, null, 2));
  return aiResponseJson;
  // --- シミュレーションここまで ---
}


function processPrompt(formObject) {
  const scriptId = formObject.scriptId;
  const prompt = formObject.prompt;

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;
    
    // ステップ1: 現在のプロジェクト内容を取得
    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) throw new Error(`スクリプト内容の取得に失敗: ${getResponse.getContentText()}`);
    const projectContent = JSON.parse(getResponse.getContentText());

    // ステップ2: AIを呼び出して、修正後のコードを取得
    const aiResponse = callGenerativeAI(prompt, projectContent);

    // ステップ3: AIの応答を基に、プロジェクト内容を更新
    aiResponse.files.forEach(updatedFile => {
      const targetFile = projectContent.files.find(file => file.name === updatedFile.name);
      if (targetFile) {
        targetFile.source = updatedFile.source;
      }
    });

    // ステップ4: 修正した内容でプロジェクト全体を更新
    const putOptions = { method: 'put', headers: { 'Authorization': `Bearer ${accessToken}` }, contentType: 'application/json', payload: JSON.stringify(projectContent), muteHttpExceptions: true };
    const putResponse = UrlFetchApp.fetch(contentUrl, putOptions);
    if (putResponse.getResponseCode() !== 200) throw new Error(`スクリプトの更新に失敗: ${putResponse.getContentText()}`);

    return `スクリプト (ID: ${scriptId}) の更新に成功しました。AIの提案に基づき、ファイルを更新しました。`;

  } catch (e) {
    console.error(e);
    return `Error: ${e.message}`;
  }
}
