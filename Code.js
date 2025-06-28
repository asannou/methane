// --- Gemini API Configuration ---
// スクリプトプロパティからAPIキーを読み込む
const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-04-17:generateContent?key=${API_KEY}`;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index').setTitle('Methane AI Agent');
}

/**
 * Gemini APIを呼び出す関数
 * @param {string} userPrompt - ユーザーが入力したプロンプト
 * @param {object} projectContent - 対象プロジェクトの全ファイル情報
 * @returns {object} - AIが生成した修正後のファイル情報を含むオブジェクト
 */
function callGenerativeAI(userPrompt, projectContent) {
  // AIに渡すための詳細な指示書（システムプロンプト）を作成
  let systemPrompt = "あなたはGoogle Apps Scriptの専門家です。以下のファイル群とユーザーの指示を基に、修正後のファイル内容を生成してください。\n\n";
  systemPrompt += "## 既存のファイル一覧\n";
  projectContent.files.forEach(file => {
    const fileExtension = file.type === 'SERVER_JS' ? 'gs' : (file.type === 'JSON' ? 'json' : 'html');
    systemPrompt += `### ファイル名: ${file.name}.${fileExtension}\n`;
    systemPrompt += "```\n" + file.source + "\n```\n\n";
  });
  systemPrompt += `## ユーザーの指示\n${userPrompt}\n\n`;
  systemPrompt += "## あなたのタスク\n";
  systemPrompt += "- 上記の指示に従って、変更が必要なファイルの新しいソースコードを生成してください。\n";
  systemPrompt += "- レスポンスは必ず、以下のJSON形式のみで返してください。\n";
  systemPrompt += "- 重要:\nファイル名は、上記「既存のファイル一覧」で提示されたものを、一字一句変えずにそのまま使用してください。翻訳や変更は絶対にしないでください。\n";
  systemPrompt += "- 変更が不要なファイルはレスポンスに含めないでください。\n";
  systemPrompt += "- JSON以外の説明や前置き、言い訳は一切不要です。\n\n";
  systemPrompt += "レスポンス形式の例:\n";
  systemPrompt += "```json\n{\"files\": [{\"name\": \"Code\", \"type\": \"SERVER_JS\", \"source\": \"...新しいソース...\"}]}\n```";

  // Gemini APIに送信するリクエストボディを作成
  const requestBody = {
    "contents": [{
      "parts": [{ "text": systemPrompt }]
    }],
    "generationConfig": {
      "response_mime_type": "application/json"
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  // Gemini APIを呼び出す
  console.log("Gemini APIにリクエストを送信します...");
  const response = UrlFetchApp.fetch(API_URL, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini APIエラー (Status: ${responseCode}): ${responseBody}`);
  }

  // レスポンスから生成されたテキスト部分を抽出
  const jsonResponse = JSON.parse(responseBody);
  // Generated text might be wrapped in markdown code block
  let generatedText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
  // Attempt to clean up markdown JSON block
  generatedText = generatedText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();

  console.log("Geminiからの応答:\n" + generatedText);

  // AIが生成したJSON文字列をパースして返す
  // ここでのJSON.parseが失敗する可能性があるが、これはprocessPrompt側で捕捉する
  return JSON.parse(generatedText);
}


function processPrompt(formObject) {
  const scriptId = formObject.scriptId;
  const prompt = formObject.prompt;

  if (!API_KEY) {
    return "Error: Gemini APIキーが設定されていません。スクリプトプロパティを確認してください。";
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) throw new Error(`スクリプト内容の取得に失敗: ${getResponse.getContentText()}`);
    const projectContent = JSON.parse(getResponse.getContentText());

    // AIを呼び出す
    const aiResponse = callGenerativeAI(prompt, projectContent);

    // AI応答の処理をtry-catchで囲み、不正なJSON/構造に対応
    try {
      // AI応答が期待される形式であるか最低限チェック
      if (!aiResponse || !Array.isArray(aiResponse.files)) {
        // console.log("AI応答の形式が不正です: ", aiResponse);
        throw new Error("AIからの応答が不正な形式です。'files'プロパティが見つからないか、配列ではありません。");
      }

      // ファイルの更新または追加
      aiResponse.files.forEach(updatedFile => {
        // AI応答に含まれる各ファイルオブジェクトの最低限の構造チェック
        if (!updatedFile || typeof updatedFile.name !== 'string' || typeof updatedFile.source !== 'string' || typeof updatedFile.type !== 'string') {
             console.warn("AI応答に含まれるファイルオブジェクトが不正な形式です。スキップします:", updatedFile);
             return; // この不正なファイルオブジェクトはスキップ
        }

        const targetFile = projectContent.files.find(file => file.name === updatedFile.name);
        if (targetFile) {
          // 既存ファイルのソースを更新 (タイプは維持)
          targetFile.source = updatedFile.source;
          // AIが既存ファイル名を維持するように指示されているため、type変更は想定しない
        } else {
          // AIが既存にないファイル名を返した場合（指示には反するが、エラーとして扱う）
          // 既存ファイル名の使用を指示しているため、ここに到達しないことを期待する。
          // 万一ここに到達した場合はエラーとする。
          throw new Error(`AIが既存にないファイル名 '${updatedFile.name}' を返しました。既存ファイルのみ更新可能です。`);
        }
      });

      // スクリプト内容を更新
      const putOptions = { method: 'put', headers: { 'Authorization': `Bearer ${accessToken}` }, contentType: 'application/json', payload: JSON.stringify(projectContent), muteHttpExceptions: true };
      const putResponse = UrlFetchApp.fetch(contentUrl, putOptions);
      if (putResponse.getResponseCode() !== 200) throw new Error(`スクリプトの更新に失敗: ${putResponse.getContentText()}`);

      return `スクリプト (ID: ${scriptId}) の更新に成功しました。AIの提案に基づき、ファイルを更新しました。`;

    } catch (aiProcessingError) {
      // AI応答のパースエラー（callGenerativeAIからのスロー）、
      // aiResponseオブジェクトの構造不正、ファイル処理中のエラーなどを捕捉
      console.error("AI応答の処理エラー:", aiProcessingError);
      return `Error processing AI response: ${aiProcessingError.message}`; // UIにAI関連のエラーとして表示
    }

  } catch (generalError) {
    // API呼び出し、スクリプトサービス連携、その他の予期しないエラーを捕捉
    console.error("General processing error:", generalError);
    return `Error: ${generalError.message}`; // UIに一般的なエラーとして表示
  }
}