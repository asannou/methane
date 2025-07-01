/**
 * ユーザーの指示に基づいて、AIに変更の方針を生成させます。
 * 実際のコード変更は行いません。
 * @param {object} formObject - フォームデータ { scriptId: string, prompt: string }
 * @returns {object} - AIが生成した変更方針を含むオブジェクト
 */
function generateProposalPolicy(formObject) {
  const scriptId = formObject.scriptId;
  const userPrompt = formObject.prompt;

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

    let aiPrompt = `あなたはGoogle Apps Scriptの専門家です。以下のファイル群とユーザーの指示を基に、どのような変更を提案するか、その大まかな「方針」を簡潔に、箇条書きでまとめてください。\n\n`;
    aiPrompt += `コードの詳細は不要で、目的、アプローチ、影響範囲など、高レベルな視点から説明してください。\n\n`;
    aiPrompt += "## 既存のファイル一覧\n";
    projectContent.files.forEach(file => {
      const fileExtension = file.type === 'SERVER_JS' ? 'gs' : (file.type === 'JSON' ? 'json' : 'html');
      aiPrompt += `### ファイル名: ${file.name}.${fileExtension}\n`;
      aiPrompt += "```\n" + file.source + "\n```\n\n";
    });
    aiPrompt += `## ユーザーの指示\n${userPrompt}\n\n`;
    aiPrompt += `## あなたのタスク\n上記指示に対する変更方針をJSON形式で返してください。JSONには'policy'フィールドに方針の文字列を含めてください。\n`;
    aiPrompt += `レスポンス形式の例:\n\
` + `\
` + `{\"policy\": \"...変更方針のテキスト...\"}\n\
` + `\
` + `\
`;

    // Call Gemini API with a specific schema for policy generation
    const requestBody = {
      "contents": [{
        "parts": [{ "text": aiPrompt }]
      }],
      "generationConfig": {
        "response_mime_type": "application/json",
        "response_schema": {
          "type": "OBJECT",
          "properties": {
            "policy": {
              "type": "STRING",
              "description": "提案される変更の大まかな方針."
            }
          },
          "required": ["policy"]
        }
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(requestBody),
      muteHttpExceptions: true
    };

    console.log("Gemini APIに方針生成リクエストを送信します...");
    const response = UrlFetchApp.fetch(API_URL, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      throw new Error(`Gemini APIエラー (Status: ${responseCode}): ${responseBody}`);
    }

    const jsonResponse = JSON.parse(responseBody);
    let generatedText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';
    generatedText = generatedText.replace(/^```json\n/, '').replace(/\n```$/, '').trim();

    console.log("Geminiからの方針応答（抜粋）:\n" + generatedText.substring(0, 2000) + (generatedText.length > 2000 ? "... (後略)" : ""));

    try {
      const policyResponse = JSON.parse(generatedText);
      if (policyResponse && policyResponse.policy) {
        return { status: 'policy', policy: policyResponse.policy, scriptId: scriptId, userPrompt: userPrompt };
      } else {
        throw new Error("AIからの応答が不正な形式です。'policy'プロパティが見つかりません。");
      }
    } catch (e) {
      throw new Error(`AIからの方針JSON応答の解析に失敗しました: ${e.message}. 受信したテキスト（先頭500文字）: ${generatedText.substring(0, 500)}...`);
    }

  } catch (error) {
    console.error("方針生成中にエラーが発生しました:", error);
    return { status: 'error', message: `方針生成エラー: ${error.message}` };
  }
}

/**
 * AIによるスクリプト変更の提案を生成し、フロントエンドに返します。
 * 実際の変更は行いません。
 * @param {object} formObject - フォームデータ { scriptId: string, prompt: string, policy?: string }
 * @returns {object} - AIが提案した修正、元のファイル、スクリプトIDを含むオブジェクト
 */
function processPrompt(formObject) {
  const scriptId = formObject.scriptId;
  const prompt = formObject.prompt;
  const policyText = formObject.policy;

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

    const aiResponse = callGenerativeAI(prompt, projectContent, policyText);

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
 * スクリプトログに基づいてAIにエラー修正を提案させます。
 * @param {string} targetScriptId - ログを取得し、修正を提案するApps ScriptのID
 * @returns {object} - AIが提案した修正、元のファイル、スクリプトIDを含むオブジェクト
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