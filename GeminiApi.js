const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

/**
 * Internal helper to construct the Gemini API base URL based on configured model.
 * @returns {string} The base URL for Gemini content generation.
 */
function _getGeminiBaseUrl() {
  const modelName = PropertiesService.getScriptProperties().getProperty('GEMINI_MODEL_NAME') || 'gemini-2.5-flash-preview-05-20'; // Default model as per policy
  return `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${API_KEY}`;
}

/**
 * Gemini APIを呼び出す関数
 * @param {string} userPrompt - ユーザーが入力したプロンプト
 * @param {object} projectContent - 対象プロジェクトの全ファイル情報
 * @param {string} [policy] - AIが生成した変更方針（オプション）
 * @returns {object} - AIが生成した修正後のファイル情報を含むオブジェクト (filesとdeletedFileNamesを含む)
 */
function callGenerativeAI(userPrompt, projectContent, policy = null) {
  let systemPrompt = "あなたはGoogle Apps Scriptの専門家です。以下のファイル群とユーザーの指示を基に、修正後のファイル内容を生成してください。\n\n";
  if (policy) {
    systemPrompt += "## AI生成ポリシー:\n" + policy + "\n\n";
    systemPrompt += "上記のポリシーを考慮し、以下のユーザーの指示を達成するための修正を提案してください。\n\n";
  }
  systemPrompt += "## 既存のファイル一覧\n";
  projectContent.files.forEach(file => {
    const fileExtension = file.type === 'SERVER_JS' ? 'gs' : (file.type === 'JSON' ? 'json' : 'html');
    systemPrompt += `### ファイル名: ${file.name}.${fileExtension}\n`;
    systemPrompt += "```\n" + file.source + "\n```\n\n";
  });
  systemPrompt += `## ユーザーの指示\n${userPrompt}\n\n`;
  systemPrompt += "## あなたのタスク\n";
  systemPrompt += "- 上記の指示に従って、変更が必要なファイルの新しいソースコードを生成してください。\n";
  systemPrompt += "- AIは以下の2種類の変更操作を提案できます。ファイル全体を更新する`source`操作よりも、特定の文字列を置換する`REPLACE`操作を優先してください。\n";
  systemPrompt += "  1. `source`によるファイル内容の更新/追加:\n";
  systemPrompt += "     - `name`: ファイル名\n";
  systemPrompt += "     - `type`: ファイルタイプ（`SERVER_JS`, `JSON`, `HTML`のいずれか）\n";
  systemPrompt += "     - `source`: 変更後のファイル内容全体の文字列\n";
  systemPrompt += "  2. `replace`による文字列置換:\n";
  systemPrompt += "     - `name`: 置換操作を行う対象ファイルの名前\n";
  systemPrompt += "     - `type`: `REPLACE` (固定)\n";
  systemPrompt += "     - `old_string`: 置換対象の文字列。**誤った置換を防ぐため、変更箇所の前後数行の文脈を含めることを強く推奨します。これにより、意図した箇所だけを正確に変更します。**\n";
  systemPrompt += "     - `new_string`: 置換後の新しい文字列。\n";
  systemPrompt += "     - `isGlobalReplace`: (オプション, boolean) trueの場合、`old_string`の全ての出現箇所を`new_string`に置換します。falseまたは未指定の場合、最初の出現箇所のみを置換します。\n";
  systemPrompt += "- **ファイルの削除を提案する場合、そのファイルはAIのレスポンスの`files`配列から除外してください。そして、そのファイル名を`deletedFileNames`配列にリストアップしてください。これにより、ユーザーインターフェースで削除されたファイルと変更がないファイルが明確に区別されます。**\n";
  systemPrompt += "  - 新しいファイルを提案する場合、適切なファイル名（例: `NewScript`, `util`, `styles`, `dialog`など）とタイプ（`SERVER_JS`, `HTML`, `JSON`のいずれか）を含めてください。\n";
  systemPrompt += "  - 変更が不要なファイルはレスポンスに含めないでください。\n";
  systemPrompt += "  - 生成するソースコードの内容において、ユーザーの指示に直接関連しない無関係な変更（不必要な**改行（ラインブレイク）**の追加・除去、インデント、空白文字、コメントの修正・削除、未使用コードの削除など）を**一切行わない**ことを最優先してください。**特に、変更対象ではないファイルや、変更が必要ないコードブロックについては、元の書式（改行、インデント、空白文字、コメントを含む）を完全に、かつ厳密に維持してください。**\n";
  systemPrompt += "  - 生成されるコードは必ず構文的に有効で、完全なものとしてください。特に、ソースコード内のコメント、空行、ブロックのインデント、**そして改行は非常に重要です。HTMLファイルにおいては、`script`タグ内のJavaScriptやスタイルシートを含め、元の構造とインデント、改行を厳密に保持してください。**これにより、AI提案の粒度と精度を向上させ、ユーザーがレビューする際のノイズを最小限に抑え、意図しない副作用や予期せぬ挙動のリスクを低減することを目的とします。\n";
  systemPrompt += "- JSON以外の説明や前置き、言い訳は一切不要です。\n\n";
  systemPrompt += "レスポンス形式の例:\n";
  systemPrompt += "```json\n{\"purpose\": \"変更の主旨を簡潔に説明してください。\", \"files\": [{\"name\": \"Code\", \"type\": \"SERVER_JS\", \"source\": \"function example() {\\n  Logger.log('Hello, world!');\\n}\"}, {\"name\": \"MyScript\", \"type\": \"REPLACE\", \"old_string\": \"oldFunctionCall(arg);\", \"new_string\": \"newFunctionCall(arg);\"}], \"deletedFileNames\": [\"OldFile\"]}\n```";
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
              "oneOf": [
                {
                  "type": "OBJECT",
                  "properties": {
                    "name": {
                      "type": "STRING",
                      "description": "ファイル名（例: Code, appsscript, index）"
                    },
                    "source": {
                      "type": "STRING",
                      "description": "変更後のファイル内容。"
                    },
                    "type": {
                      "type": "STRING",
                      "description": "ファイルタイプ（SERVER_JS, JSON, HTMLのいずれか）",
                      "enum": ["SERVER_JS", "JSON", "HTML"]
                    }
                  },
                  "required": ["name", "type", "source"]
                },
                {
                  "type": "OBJECT",
                  "properties": {
                    "name": {
                      "type": "STRING",
                      "description": "置換操作を行う対象ファイルの名前。"
                    },
                    "type": {
                      "type": "STRING",
                      "description": "操作タイプ（REPLACE固定）",
                      "enum": ["REPLACE"]
                    },
                    "old_string": {
                      "type": "STRING",
                      "description": "置換対象の文字列。誤った置換を防ぐため、変更箇所の前後数行の文脈を含めることを強く推奨。"
                    },
                    "new_string": {
                      "type": "STRING",
                      "description": "置換後の新しい文字列。"
                    },
                    "isGlobalReplace": {
                      "type": "boolean",
                      "description": "trueの場合、old_stringの全ての出現箇所をnew_stringに置換します。falseまたは未指定の場合、最初の出現箇所のみを置換します。",
                      "default": false
                    }
                  },
                  "required": ["name", "type", "old_string", "new_string"]
                }
              ]
            },
            "description": "修正が必要なファイルの新しいソースコードを含むオブジェクトの配列、または置換操作の配列。"
          },
          "deletedFileNames": {
            "type": "ARRAY",
            "items": {
              "type": "STRING"
            },
            "description": "削除を提案するファイルのファイル名の配列。"
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
  console.log("リクエストペイロード（抜粋）:\n" + options.payload.substring(0, 2000) + (options.payload.length > 2000 ? "... (後略)" : ""));
  const response = UrlFetchApp.fetch(_getGeminiBaseUrl(), options);
  const responseCode = response.getResponseCode();
  const responseBody = response.getContentText();

  if (responseCode !== 200) {
    throw new Error(`Gemini APIエラー (Status: ${responseCode}): ${responseBody}`);
  }

  let jsonResponse;
  try {
    jsonResponse = JSON.parse(responseBody);
  } catch (e) {
    throw new Error(`Gemini API応答のJSON解析に失敗しました: ${e.message}. 受信したボディ: ${responseBody}`);
  }

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