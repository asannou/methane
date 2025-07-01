const API_KEY = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${API_KEY}`;

/**
 * Gemini APIを呼び出す関数
 * @param {string} userPrompt - ユーザーが入力したプロンプト
 * @param {object} projectContent - 対象プロジェクトの全ファイル情報
 * @param {string} [policy] - AIが生成した変更方針（オプション）
 * @returns {object} - AIが生成した修正後のファイル情報を含むオブジェクト
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
  systemPrompt += "- レスポンスは必ず、以下のJSON形式のみで返してください。\n";
  systemPrompt += "- 重要:\n";
  systemPrompt += "  - 変更が必要なファイル、または**新しく追加したいファイル**の新しいソースコードを生成してください。\n";
  systemPrompt += "  - 新しいファイルを提案する場合、適切なファイル名（例: `NewScript`, `util`, `styles`, `dialog`など）とタイプ（`SERVER_JS`, `HTML`, `JSON`のいずれか）を含めてください。\n";
  systemPrompt += "  - 変更が不要なファイルはレスポンスに含めないでください。\n";
  systemPrompt += "  - 生成するソースコードの内容は、指示と無関係な改行、インデント、空白文字の削除や変更を完全に禁止し、元のファイルの書式を厳密に維持することを最優先してください。特にHTMLファイルでは、元の構造とインデントを厳密に保持してください。生成されるコードは必ず構文的に有効で、完全なものとしてください。特に、ソースコード内のコメント、空行、ブロックのインデントなどは重要です。\n";
  systemPrompt += "- JSON以外の説明や前置き、言い訳は一切不要です。\n\n";
  systemPrompt += "レスポンス形式の例:\n";
  systemPrompt += "```json\n{\"purpose\": \"変更の主旨を簡潔に説明してください。\", \"files\": [{\"name\": \"Code\", \"type\": \"SERVER_JS\", \"source\": \"function example() {\\n  Logger.log('Hello, world!');\\n}\"}]}\n```";
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