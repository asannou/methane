const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

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
  systemPrompt += "- 重要:\n";
  systemPrompt += "  - ファイル名は、上記「既存のファイル一覧」で提示されたものを、一字一句変えずにそのまま使用してください。翻訳や変更は絶対にしないでください。\n";
  systemPrompt += "  - 変更が不要なファイルはレスポンスに含めないでください。\n";
  systemPrompt += "  - 生成するソースコードの内容は、指示に関係のない改行、インデント、空白文字などを勝手に変更したり除去したりせず、可能な限り元のフォーマットを維持してください。生成されるコードは必ず構文的に有効で、完全なものとしてください。特に、ソースコード内のコメント、空行、ブロックのインデントなどは重要です。\n";
  systemPrompt += "- JSON以外の説明や前置き、言い訳は一切不要です。\n\n";
  systemPrompt += "レスポンス形式の例:\n";
  systemPrompt += "```json\n{\"purpose\": \"変更の主旨を簡潔に説明してください。\", \"files\": [{\"name\": \"Code\", \"type\": \"SERVER_JS\", \"source\": \"...新しいソース...\"}]}\n```";
  systemPrompt += "- 'purpose'フィールドには、提案された変更の全体的な目的や理由を、ユーザーが理解しやすいように簡潔に説明してください。\n";

  const requestBody = {
    "contents": [{
      "parts": [{ "text": systemPrompt }]
    }],
    "generationConfig": {
      "response_mime_type": "application/json",
      "response_schema": {
        "type": "OBJECT",
        "properties": {
          "purpose": {
            "type": "STRING",
            "description": "変更の主旨を簡潔に説明してください。"
          },
          "files": {
            "type": "ARRAY",
            "items": {
              "type": "OBJECT",
              "properties": {
                "name": {
                  "type": "STRING",
                  "description": "ファイル名（例: Code, appsscript, index）"
                },
                "type": {
                  "type": "STRING",
                  "enum": ["SERVER_JS", "JSON", "HTML"],
                  "description": "ファイルタイプ（SERVER_JS, JSON, HTMLのいずれか）"
                },
                "source": {
                  "type": "STRING",
                  "description": "変更後のファイル内容"
                }
              },
              "required": ["name", "type", "source"]
            },
            "description": "修正が必要なファイルの新しいソースコードを含むオブジェクトの配列。"
          }
        },
        "required": ["purpose", "files"]
      }
    }
  };

  const options = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(requestBody),
    muteHttpExceptions: true
  };

  console.log("Gemini APIにリクエストを送信します...");
  const response = UrlFetchApp.fetch(API_URL, options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini APIエラー (Status: ${responseCode}): ${responseBody}`);
  }

  const jsonResponse = JSON.parse(responseBody);
  let generatedText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
  generatedText = generatedText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();

  // ログ出力のサイズが大きすぎる問題を回避するため、出力を制限
  console.log("Geminiからの応答（抜粋）:\n" + generatedText.substring(0, 2000) + (generatedText.length > 2000 ? "... (後略)" : ""));

  try {
    return JSON.parse(generatedText);
  } catch (e) {
    throw new Error(`AIからのJSON応答の解析に失敗しました: ${e.message}. 受信したテキスト（先頭500文字）: ${generatedText.substring(0, 500)}...`);
  }
}

/**
 * AIによるスクリプト変更の提案を生成し、フロントエンドに返します。
 * 実際の変更は行いません。
 * @param {object} formObject - フォームデータ { scriptId: string, prompt: string }
 * @returns {object} - AIが提案した変更、元のファイル、スクリプトIDを含むオブジェクト
 */
function processPrompt(formObject) {
  const scriptId = formObject.scriptId;
  const prompt = formObject.prompt;

  if (!API_KEY) {
    return { status: 'error', message: "Error: Gemini APIキーが設定されていません。スクリプトプロパティを確認してください。" };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) {
        throw new Error(`スクリプト内容の取得に失敗: ${getResponse.getContentText()}`);
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    const aiResponse = callGenerativeAI(prompt, projectContent);

    if (!aiResponse || !Array.isArray(aiResponse.files)) {
      throw new Error("AIからの応答が不正な形式です。'files'プロパティが見つからないか、配列ではありません。");
    }

    const proposalPurpose = aiResponse.purpose || "AIは変更の主旨を提供しませんでした。";

    return { 
      status: 'proposal',
      scriptId: scriptId,
      originalFiles: projectContent.files,
      proposedFiles: aiResponse.files,
      purpose: proposalPurpose,
      message: "AIからの提案が生成されました。内容を確認し、適用してください。"
    };

  } catch (error) {
    console.error("AI提案生成中にエラーが発生しました:", error);
    return { status: 'error', message: `AI提案生成エラー: ${error.message}` };
  }
}

/**
 * ユーザーが承認したAIの提案に基づいてスクリプトファイルを更新します。
 * @param {string} scriptId - 更新対象のスクリプトID
 * @param {Array<object>} proposedFiles - AIが提案した（ユーザー承認済みの）ファイルオブジェクトの配列
 * @returns {object} - 処理結果 (成功/失敗) を示すオブジェクト
 */
function applyProposedChanges(scriptId, proposedFiles) {
  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) {
        throw new Error(`スクリプト内容の再取得に失敗: ${getResponse.getContentText()}`);
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    proposedFiles.forEach(updatedFile => {
      if (!updatedFile || typeof updatedFile.name !== 'string' || typeof updatedFile.source !== 'string' || typeof updatedFile.type !== 'string') {
           console.warn("AI応答に含まれるファイルオブジェクトが不正な形式です。スキップします:", JSON.stringify(updatedFile, null, 2));
           return;
      }

      const targetFile = projectContent.files.find(file => file.name === updatedFile.name);
      if (targetFile) {
        targetFile.source = updatedFile.source;
      } else {
        throw new Error(`AIが既存にないファイル名 '${updatedFile.name}' を返しました。既存ファイルのみ更新可能です。`);
      }
    });

    const putOptions = { method: 'put', headers: { 'Authorization': `Bearer ${accessToken}` }, contentType: 'application/json', payload: JSON.stringify(projectContent), muteHttpExceptions: true };
    const putResponse = UrlFetchApp.fetch(contentUrl, putOptions);
    if (putResponse.getResponseCode() !== 200) {
        throw new Error(`スクリプトの更新に失敗: ${putResponse.getContentText()}`);
    }

    return { status: 'success', message: `スクリプト (ID: ${scriptId}) の更新に成功しました。AIの提案が適用されました。` };

  } catch (error) {
    console.error("スクリプト適用中にエラーが発生しました:", error);
    return { status: 'error', message: `スクリプト適用エラー: ${error.message}` };
  }
}

/**
 * Google Cloud PlatformプロジェクトIDを設定します。
 * @param {string} gcpProjectId - 設定するGCPプロジェクトID
 * @returns {object} - 処理結果 (成功/失敗) を示すオブジェクト
 */
function setGcpProjectId(gcpProjectId) {
  if (!gcpProjectId || gcpProjectId.trim() === '') {
    return { status: 'error', message: 'GCPプロジェクトIDは空にできません。' };
  }
  try {
    PropertiesService.getScriptProperties().setProperty('GCP_PROJECT_ID', gcpProjectId.trim());
    return { status: 'success', message: `GCPプロジェクトID '${gcpProjectId.trim()}' が正常に設定されました。` };
  } catch (e) {
    console.error("GCPプロジェクトIDの設定中にエラーが発生しました:", e);
    return { status: 'error', message: `GCPプロジェクトIDの設定エラー: ${e.message}` };
  }
}

/**
 * 指定されたApps ScriptのログをCloud Loggingから取得する関数
 * @param {string} targetScriptId - ログを取得するApps ScriptのID (このIDはGCPプロジェクト内の全てのApps Scriptログを取得するために使用されません)
 * @returns {string} - フォーマットされたログ文字列、またはエラーメッセージ
 */
function getScriptLogs(targetScriptId) {
  const accessToken = ScriptApp.getOAuthToken();
  const currentScriptId = ScriptApp.getScriptId();

  try {
    let gcpProjectId = PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID');

    if (!gcpProjectId) {
      console.log("Script propertiesにGCPプロジェクトIDが見つかりません。メタデータから取得を試みます。");
      const currentScriptMetadataUrl = `https://script.googleapis.com/v1/projects/${currentScriptId}`;
      const metadataOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
      const metadataResponse = UrlFetchApp.fetch(currentScriptMetadataUrl, metadataOptions);
      
      if (metadataResponse.getResponseCode() !== 200) {
        throw new Error(`現在のスクリプトのメタデータ取得に失敗: ${metadataResponse.getContentText()}`);
      }
      const metadata = JSON.parse(metadataResponse.getContentText());

      if (!metadata || typeof metadata.name !== 'string' || !metadata.name.startsWith('projects/')) {
        console.error("Received metadata:", JSON.stringify(metadata, null, 2));
        const userGuidance = "スクリプトのGCPプロジェクトIDを特定できませんでした。これは、現在のApps Scriptプロジェクトが標準のGoogle Cloudプロジェクトにリンクされていない場合に発生することがあります。Apps Scriptエディタの「プロジェクトの設定」（歯車アイコン）から、Google Cloud Platformプロジェクトを明示的にリンクするか、ウェブUIで手動で設定してください。";
        throw new Error(userGuidance);
      }

      const gcpProjectIdMatch = metadata.name.match(/^projects\/([^\/]+)\/scripts\/.+$/);
      if (!gcpProjectIdMatch || !gcpProjectIdMatch[1]) {
        throw new Error("現在のスクリプトのGCPプロジェクトIDを、メタデータから正しく抽出できませんでした。");
      }
      gcpProjectId = gcpProjectIdMatch[1];
      PropertiesService.getScriptProperties().setProperty('GCP_PROJECT_ID', gcpProjectId);
      console.log("メタデータからGCPプロジェクトIDを取得し、保存しました:", gcpProjectId);
    } else {
      console.log("Script propertiesからGCPプロジェクトIDを取得しました:", gcpProjectId);
    }

    const loggingApiUrl = 'https://logging.googleapis.com/v2/entries:list';
    const requestBody = {
      "resourceNames": [
        `projects/${gcpProjectId}`
      ],
      "filter": `resource.type="app_script_function"`,
      "orderBy": "timestamp desc",
      "pageSize": 50
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      headers: { 'Authorization': `Bearer ${accessToken}` },
      muteHttpExceptions: true
    };

    console.log(`スクリプトID ${targetScriptId} のログをGCPプロジェクト ${gcpProjectId} から取得中...`);
    const response = UrlFetchApp.fetch(loggingApiUrl, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      throw new Error(`Cloud Logging APIエラー (ステータス: ${responseCode}): ${responseBody}`);
    }

    const logsData = JSON.parse(responseBody);
    if (!logsData.entries || logsData.entries.length === 0) {
      return "指定されたスクリプトIDに関連する、またはGCPプロジェクト全体でApps Scriptのログが見つかりませんでした。\n";
    }

    let formattedLogs = "--- 最新のログ ---\n";
    logsData.entries.forEach(entry => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      let logPayload = '';
      if (entry.textPayload) {
        logPayload = entry.textPayload;
      } else if (entry.jsonPayload) {
        logPayload = JSON.stringify(entry.jsonPayload, null, 2);
      } else if (entry.protoPayload) {
        logPayload = JSON.stringify(entry.protoPayload, null, 2);
      }
      formattedLogs += `[${timestamp}] ${entry.severity || 'INFO'}: ${logPayload}\n`;
    });

    return formattedLogs;

  } catch (e) {
    console.error("ログ取得中にエラーが発生しました:", e);
    return `ログ取得エラー: ${e.message}`;
  }
}

/**
 * スクリプトの新しいバージョンを作成し、それを新しいウェブアプリとしてデプロイします。
 * appsscript.jsonに定義されたウェブアプリ設定を適用します。
 * @param {string} scriptId - デプロイするスクリプトのID
 * @param {string} description - デプロイの説明（オプション）
 * @returns {object} - デプロイ結果（成功/失敗、デプロイID、URL）
 */
function deployScript(scriptId, description = '') {
  console.log("deployScript function called. Script ID:", scriptId, "Description:", description);
  const accessToken = ScriptApp.getOAuthToken();
  const versionsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;
  const deploymentsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;

  try {
    // 1. 新しいバージョンを作成する
    console.log("新しいスクリプトバージョンを作成中...");
    const createVersionPayload = { description: `Deployment version created by Methane AI Agent: ${description}` };
    console.log("バージョン作成リクエストペイロード:", JSON.stringify(createVersionPayload));

    const createVersionOptions = {
      method: 'post',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      payload: JSON.stringify(createVersionPayload),
      muteHttpExceptions: true
    };
    const createVersionResponse = UrlFetchApp.fetch(versionsApiUrl, createVersionOptions);
    const createVersionResponseCode = createVersionResponse.getResponseCode();
    const createVersionResponseBody = createVersionResponse.getContentText();

    console.log(`バージョン作成API応答 - ステータス: ${createVersionResponseCode}, ボディ: ${createVersionResponseBody}`);

    if (createVersionResponseCode !== 200) {
      throw new Error(`バージョン作成APIエラー (ステータス: ${createVersionResponseCode}): ${createVersionResponseBody}`);
    }
    const versionResult = JSON.parse(createVersionResponseBody);
    console.log("解析されたバージョン作成応答データ:", JSON.stringify(versionResult, null, 2));
    const versionNumber = versionResult.versionNumber;
    console.log(`新しいバージョンが作成されました: Version ${versionNumber}`);

    // 3. デプロイAPIのペイロードを正しく構築する
    // ログのエラー「Unknown name "deploymentConfig": Cannot find field.」を解決するため、
    // createDeployment APIのペイロードから"deploymentConfig"を削除し、直接プロパティを渡します。
    const deploymentRequestBody = {
      "versionNumber": versionNumber,
      "manifestFileName": "appsscript",
      "description": description
    };
    console.log("デプロイリクエストペイロード:", JSON.stringify(deploymentRequestBody));

    const deployOptions = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(deploymentRequestBody),
      headers: { 'Authorization': `Bearer ${accessToken}` },
      muteHttpExceptions: true
    };

    console.log(`スクリプトID ${scriptId} のバージョン ${versionNumber} をウェブアプリとしてデプロイ中...`);
    const response = UrlFetchApp.fetch(deploymentsApiUrl, deployOptions);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    console.log(`デプロイAPI応答 - ステータス: ${responseCode}, ボディ: ${responseBody}`);

    if (responseCode !== 200) {
      throw new Error(`デプロイAPIエラー (ステータス: ${responseCode}): ${responseBody}`);
    }

    const deploymentResult = JSON.parse(responseBody);
    console.log("デプロイ成功応答データ:", JSON.stringify(deploymentResult, null, 2));

    // デプロイ結果からWebアプリURLを安全に抽出するように修正
    let webappUrl;
    if (deploymentResult.entryPoints && Array.isArray(deploymentResult.entryPoints) && deploymentResult.entryPoints.length > 0) {
      console.log("デプロイ応答のentryPointsプロパティ:", JSON.stringify(deploymentResult.entryPoints));
      const entryPoint = deploymentResult.entryPoints[0];
      if (entryPoint?.webApp?.url) {
        webappUrl = entryPoint.webApp.url;
        console.log("WebアプリURLをentryPointから抽出しました:", webappUrl);
      } else if (entryPoint?.webApp) {
        console.warn("ウェブアプリのURLがデプロイ応答のwebAppオブジェクト内に見つかりませんでした。webAppオブジェクト:", JSON.stringify(entryPoint.webApp, null, 2));
      } else {
        console.warn("デプロイ応答のentryPointにwebAppオブジェクトが見つかりませんでした。entryPoint:", JSON.stringify(entryPoint, null, 2));
      }
    } else {
      console.warn("デプロイ応答にentryPointsプロパティがないか、空の配列です。");
    }

    if (!webappUrl) {
      console.warn("ウェブアプリのURLがデプロイ応答で見つかりませんでした。デプロイ結果全体:", JSON.stringify(deploymentResult, null, 2));
      return {
        status: 'success',
        message: 'デプロイは正常に完了しましたが、ウェブアプリURLが見つかりませんでした。デプロイを確認してください。',
        deploymentId: deploymentResult.deploymentId,
        webappUrl: 'URL not found in response'
      };
    }

    return {
      status: 'success',
      message: 'デプロイが正常に完了しました。',
      deploymentId: deploymentResult.deploymentId,
      webappUrl: webappUrl
    };

  } catch (e) {
    console.error("デプロイ中にエラーが発生しました:", e);
    return { status: 'error', message: `デプロイエラー: ${e.message}` };
  }
}

/**
 * スクリプトログに基づいてAIにエラー修正を提案させます。
 * @param {string} targetScriptId - ログを取得し、修正を提案するApps ScriptのID
 * @returns {object} - AIが提案した変更、元のファイル、スクリプトIDを含むオブジェクト
 */
function fixErrorsFromLogs(targetScriptId) {
  if (!API_KEY) {
    return { status: 'error', message: "Error: Gemini APIキーが設定されていません。スクリプトプロパティを確認してください。" };
  }
  if (!targetScriptId || targetScriptId.trim() === '') {
    return { status: 'error', message: "Error: スクリプトIDが指定されていません。" };
  }

  try {
    // 1. ログを取得
    const logs = getScriptLogs(targetScriptId);
    // getScriptLogs はエラーメッセージも文字列として返す可能性があるため、それをチェック
    if (logs.startsWith("ログ取得エラー:") || logs.startsWith("指定されたスクリプトIDに関連する")) {
        return { status: 'error', message: logs }; // エラーメッセージやログなしメッセージをそのまま返す
    }

    // 2. 対象スクリプトの全ファイル内容を取得
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${targetScriptId}/content`;
    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) {
        throw new Error(`スクリプト内容の取得に失敗: ${getResponse.getContentText()}`);
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    // 3. AIに渡すプロンプトを生成
    let aiPrompt = `以下のGoogle Apps Scriptのログに示されたエラーを解決するために、提供された既存のファイル群を修正してください。\n`;
    aiPrompt += `修正は、エラーを解消し、既存の機能性を損なわないように、可能な限り最小限にしてください。\n\n`;
    aiPrompt += `## エラーログ\n\n${logs}\n\n`;
    aiPrompt += `## あなたのタスク\n上記のログと既存のファイルに基づいて、エラーを修正するための新しいファイル内容を提案してください。\n`;
    aiPrompt += `提案は必ずJSON形式で、修正が必要なファイルのみを含めてください。\n`;
    aiPrompt += `ファイル名、タイプ、ソースを正確に指定してください。`;

    // 4. Gemini APIを呼び出し
    const aiResponse = callGenerativeAI(aiPrompt, projectContent);

    if (!aiResponse || !Array.isArray(aiResponse.files)) {
      throw new Error("AIからの応答が不正な形式です。'files'プロパティが見つからないか、配列ではありません。");
    }

    const proposalPurpose = aiResponse.purpose || "AIは変更の主旨を提供しませんでした。";

    return {
      status: 'proposal', // processPrompt と同じステータス
      scriptId: targetScriptId,
      originalFiles: projectContent.files, // 元のファイルも返す
      proposedFiles: aiResponse.files,
      purpose: proposalPurpose,
      message: "AIからのエラー修正提案が生成されました。内容を確認し、適用してください。"
    };

  } catch (error) {
    console.error("エラー修正提案生成中にエラーが発生しました:", error);
    return { status: 'error', message: `エラー修正提案生成エラー: ${error.message}` };
  }
}