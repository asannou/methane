/**
 * Apps Script API を使用して、指定されたTarget Scriptにブラウザコンソールのエラーログ機能を提案します。
 * これには、appsscript.jsonへのスコープ追加、クライアントサイドエラーをサーバーに送信するHTMLの変更、
 * およびサーバーサイドでログを記録する新しい.gsファイルの追加が含まれます。
 *
 * @param {string} targetScriptId - 変更を提案するTarget Apps ScriptのID。
 * @returns {object} - AIが提案した修正、元のファイル、スクリプトIDを含むオブジェクト
 */
function proposeBrowserErrorLoggingChanges(targetScriptId) {
  if (!API_KEY) {
    return { status: 'error', message: "Error: Gemini API key is not set. Please check script properties." };
  }
  if (!targetScriptId || targetScriptId.trim() === '') {
    return { status: 'error', message: "Error: Target Script ID is not specified." };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${targetScriptId}/content`;

    // 1. 対象スクリプトの現在の内容を取得
    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) {
        throw new Error(`Failed to retrieve target script content: ${getResponse.getContentText()}`);
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    // 2. AIに渡すプロンプトと既存のファイルを準備
    let aiPrompt = "以下のGoogle Apps Scriptプロジェクトに、ブラウザコンソールで発生したエラーおよび警告をCloud Loggingに記録する機能を追加してください。\n\n";
    aiPrompt += "- この機能は、ウェブアプリとしてデプロイされた際にのみ有効になるように設計してください。\n";
    aiPrompt += "- クライアントサイド（HTMLファイル内）でJavaScriptの`window.onerror`、`window.onunhandledrejection`イベント、および`console.warn`メッセージを捕捉し、サーバーサイドの関数を呼び出して情報（エラーまたは警告）を送信してください。\n";
    aiPrompt += "- サーバーサイドの関数は、受け取った情報（エラーまたは警告）を適切なログレベル（例: エラーは`console.error()`、警告は`console.warn()`）を使用してCloud Loggingに記録してください。\n";
    aiPrompt += "- 必要なOAuthスコープ（`https://www.googleapis.com/auth/logging.write`）を`appsscript.json`に追加してください。\n";
    aiPrompt += "- 既存のコードの構造やロジックは変更しないでください。新しい機能を追加する形にしてください。\n";
    aiPrompt += "- クライアントサイドのスクリプトは、必要な情報（メッセージ、URL、行番号、列番号、スタックトレースなど）を捕捉し、サーバーサイドに送信してください。\n";
    aiPrompt += "- サーバーサイドでログを処理する新しい`.gs`ファイルを作成してください。ファイル名は`BrowserErrorLoggerService.gs`としてください。\n";
    aiPrompt += "- HTMLファイルへの変更は、既存の `<script>` ブロック内、または新しい `<script>` ブロックを追記する形で行い、既存の要素やスクリプトを破壊しないでください。\n";
    aiPrompt += "- HTMLとJSは、既存の規約（例: `<?!= include('file'); ?>` の使用）に従って最小限の変更をしてください。\n";
    aiPrompt += "- AI生成ポリシーの「このスクリプトにおいて実行時にブラウザコンソールで発生したエラーをCloud のログに記録させる」ものではないという指示を守ってください。つまり、提案される変更はこのスクリプト自体ではなく、**指定されたTarget Script**に対して適用されるものです。\n";


    // 3. AIを呼び出して変更を生成
    const aiResponse = callGenerativeAI(aiPrompt, projectContent);

    if (!aiResponse || !Array.isArray(aiResponse.files)) {
      throw new Error("Invalid response format from AI. 'files' property not found or is not an array.");
    }

    const proposalPurpose = aiResponse.purpose || "AI did not provide a purpose for the changes.";

    return {
      status: 'proposal',
      scriptId: targetScriptId,
      originalFiles: projectContent.files,
      proposedFiles: aiResponse.files,
      purpose: proposalPurpose,
      message: "AI proposal for browser error logging generated. Please review the content and apply."
    };

  } catch (error) {
    console.error("ブラウザエラーログ機能の提案中にエラーが発生しました:", error);
    return { status: 'error', message: `Browser error logging proposal error: ${error.message}` };
  }
}