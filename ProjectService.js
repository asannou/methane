/**
 * ユーザーが承認したAIの提案に基づいてスクリプトファイルを更新します。
 * @param {string} scriptId - 更新対象のスクリプトID
 * @param {Array<object>} proposedFiles - AIが提案した（ユーザー承認済みの）ファイルオブジェクトの配列
 * @param {boolean} autoDeploy - 変更適用後に自動的にデプロイするかどうか
 * @param {string} proposalPurpose - AIが提案した変更の主旨
 * @returns {object} - 処理結果 (成功/失敗) を示すオブジェクト
 */
function applyProposedChanges(scriptId, proposedFiles, autoDeploy, proposalPurpose) {
  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    if (getResponse.getResponseCode() !== 200) {
        return { status: 'error', message: `スクリプト内容の再取得に失敗: ${getResponse.getContentText()}`, apiErrorDetails: JSON.parse(getResponse.getContentText() || '{}') };
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    // Create a mutable copy of files to safely add/modify
    const currentFiles = [...projectContent.files];
    const updatedFilesMap = new Map(currentFiles.map(file => [file.name, file]));

    proposedFiles.forEach(updatedFile => {
      if (!updatedFile || typeof updatedFile.name !== 'string' || typeof updatedFile.source !== 'string' || typeof updatedFile.type !== 'string') {
           console.warn("AI応答に含まれるファイルオブジェクトが不正な形式です。スキップします:", JSON.stringify(updatedFile, null, 2));
           return;
      }

      const existingFile = updatedFilesMap.get(updatedFile.name);
      if (existingFile) {
        // Update existing file
        existingFile.source = updatedFile.source;
        existingFile.type = updatedFile.type; // Ensure type is also updated if needed, although usually it stays the same.
      } else {
        // Add new file
        console.log(`新しいファイル '${updatedFile.name}' (タイプ: ${updatedFile.type}) を追加します。`);
        updatedFilesMap.set(updatedFile.name, updatedFile);
      }
    });

    // Convert map back to array for payload
    projectContent.files = Array.from(updatedFilesMap.values());

    const putOptions = { method: 'put', headers: { 'Authorization': `Bearer ${accessToken}` }, contentType: 'application/json', payload: JSON.stringify(projectContent), muteHttpExceptions: true };
    const putResponse = UrlFetchApp.fetch(contentUrl, putOptions);
    if (putResponse.getResponseCode() !== 200) {
        return {
            status: 'error',
            message: `スクリプトの更新に失敗しました。(HTTP ${putResponse.getResponseCode()})`,
            apiErrorDetails: JSON.parse(putResponse.getContentText() || '{}'),
            fullErrorText: putResponse.getContentText() // Provide full text for debugging
        };
    }

    let deployResult = null;
    if (autoDeploy) {
      console.log(`自動デプロイを開始します。スクリプトID: ${scriptId}`);
      deployResult = deployScript(scriptId, proposalPurpose);
      console.log("自動デプロイ結果:", JSON.stringify(deployResult, null, 2));
    }

    return {
      status: 'success',
      message: `スクリプト (ID: ${scriptId}) の更新に成功しました。AIの提案が適用されました。`,
      deploymentStatus: deployResult ? deployResult.status : 'not_attempted',
      deploymentMessage: deployResult ? deployResult.message : '自動デプロイは実行されませんでした。',
      deploymentId: deployResult ? deployResult.deploymentId : null,
      webappUrl: deployResult ? deployResult.webappUrl : null
    };

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
 * @param {string} targetScriptId - ログを取得し、修正を提案するApps ScriptのID (このIDはGCPプロジェクト内の全てのApps Scriptログを取得するために使用されません)
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
 * デプロイメント数が上限に達している場合にのみ、最も古いウェブアプリデプロイメントをアーカイブ（削除）します。
 * @param {string} scriptId - デプロイするスクリプトのID
 * @param {string} description - デプロイの説明（オプション、AIの変更主旨または手動入力）
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
    const createVersionPayload = { description: description };
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

    const newDeploymentId = deploymentResult.deploymentId; // 新しく作成されたデプロイメントのIDを取得

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

    // --- 新しいロジック: デプロイメントが上限に達している場合にのみ古いウェブアプリデプロイメントをアーカイブ（削除）する --- 
    console.log("古いウェブアプリデプロイメントをアーカイブするか確認中...");
    const DEPLOYMENT_LIMIT = 50; // Google Apps Scriptのデプロイメント上限

    const listDeploymentsUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;
    const listOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const listResponse = UrlFetchApp.fetch(listDeploymentsUrl, listOptions);
    const listResponseBody = listResponse.getContentText();

    if (listResponse.getResponseCode() !== 200) {
      console.warn(`既存デプロイメントのリスト取得に失敗しましたが、新しいデプロイメントは成功しています。エラー: ${listResponseBody}`);
    } else {
      const allDeployments = JSON.parse(listResponseBody).deployments || [];
      console.log(`取得した全てのデプロイメント数: ${allDeployments.length}`);

      // ウェブアプリデプロイメントのみをフィルタリングし、作成時間でソート
      const webAppDeployments = allDeployments
        .filter(dep => dep.entryPoints && dep.entryPoints.some(ep => ep.webApp))
        .sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime()); // 最も古いものが先頭に来るようにソート

      console.log(`ウェブアプリデプロイメント数: ${webAppDeployments.length}`);

      // 上限に達している、または超えている場合にのみアーカイブ
      if (webAppDeployments.length >= DEPLOYMENT_LIMIT) {
        console.log(`デプロイメント数が上限 (${DEPLOYMENT_LIMIT}) に達しているため、最も古いウェブアプリデプロイメントをアーカイブします。`);
        
        // 新しく作成されたデプロイメントを除外
        const deletableDeployments = webAppDeployments.filter(dep => dep.deploymentId !== newDeploymentId);

        if (deletableDeployments.length > 0) {
          // 最も古いデプロイメント (新しいものを除く) を一つ削除
          const oldDeploymentToDelete = deletableDeployments[0]; // ソート済みなので0番目が最も古い

          console.log(`古いウェブアプリデプロイメントを削除中: ID = ${oldDeploymentToDelete.deploymentId}, 作成日時 = ${oldDeploymentToDelete.createTime}`);
          const deleteDeploymentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments/${oldDeploymentToDelete.deploymentId}`;
          const deleteOptions = { method: 'delete', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
          const deleteResponse = UrlFetchApp.fetch(deleteDeploymentUrl, deleteOptions);

          if (deleteResponse.getResponseCode() !== 200) {
            console.warn(`古いデプロイメント ${oldDeploymentToDelete.deploymentId} の削除に失敗: ${deleteResponse.getContentText()}`);
          } else {
            console.log(`古いデプロイメント ${oldDeploymentToDelete.deploymentId} を正常に削除しました。`);
          }
        } else {
          console.log("アーカイブ対象の古いウェブアプリデプロイメントが見つかりませんでした (新しいデプロイメントのみ、または数が少ない)。");
        }
      } else {
        console.log(`デプロイメント数が上限 (${DEPLOYMENT_LIMIT}) 未満のため、古いデプロイメントのアーカイブはスキップします。`);
      }
    }
    // --- 新しいロジック終了 ---

    if (!webappUrl) {
      console.warn("ウェブアプリのURLがデプロイ応答で見つかりませんでした。デプロイ結果全体:", JSON.stringify(deploymentResult, null, 2));
      return {
        status: 'success',
        message: 'デプロイは正常に完了しましたが、ウェブアプリURLが見つかりませんでした。デプロイを確認してください。古いウェブアプリデプロイメントはアーカイブされました。',
        deploymentId: newDeploymentId,
        webappUrl: 'URL not found in response'
      };
    }

    return {
      status: 'success',
      message: 'デプロイが正常に完了しました。古いウェブアプリデプロイメントはアーカイブされました。',
      deploymentId: newDeploymentId,
      webappUrl: webappUrl
    };

  } catch (e) {
    console.error("デプロイ中にエラーが発生しました:", e);
    return { status: 'error', message: `デプロイエラー: ${e.message}` };
  }
}

/**
 * Lists Apps Script projects accessible to the user using Google Drive API.
 * @returns {object} An object containing 'status' and either 'projects' (Array<object>) or 'message'.
 */
function listAppsScriptProjects() {
  try {
    // Using Drive API (Advanced Service) to list script files
    // Requires 'Drive API' to be enabled in Advanced Google Services (Resources > Advanced Google services...)
    // Requires 'https://www.googleapis.com/auth/drive.readonly' scope in appsscript.json
    console.log("ドライブAPIを使用してApps Scriptプロジェクトをリスト中...");
    
    // Filter for Apps Script files that are not trashed
    const query = 'mimeType = "application/vnd.google-apps.script" and trashed = false';
    
    // Fetch files, limit to a reasonable number (e.g., 200)
    let response = Drive.Files.list({
      q: query,
      fields: 'files(id, name)', // Changed from 'items(id,title)' for Drive API v3
      maxResults: 200 // Limit the number of results to prevent excessive load
    });

    const projects = (response.files || []).map(file => ({ // Changed from response.items to response.files
      id: file.id,       // For standalone scripts, file ID is the script ID. For bound scripts, this is the container ID.
      title: file.name  // Changed from file.title to file.name for Drive API v3
    }));

    return { status: 'success', projects: projects };

  } catch (e) {
    console.error("ドライブAPIによるApps Scriptプロジェクトのリスト中にエラーが発生しました:", e);
    let userMessage = `Apps Scriptプロジェクトのリストエラー: ${e.message}`;

    if (e.name === 'ReferenceError' && e.message.includes("Drive is not defined")) {
      userMessage = `Apps Scriptプロジェクトの取得に失敗しました。Drive API (Advanced Service) がこのApps Scriptプロジェクトで有効になっていない可能性があります。Apps Scriptエディタの「プロジェクトの設定」（歯車アイコン）>「Advanced Google Services」から「Drive API」を有効にし、このプロジェクトに関連付けられているか確認してください。また、appsscript.jsonに適切なOAuthスコープ (https://www.googleapis.com/auth/drive.readonly) が設定されていることを確認してください。`;
    } else if (e.message.includes("API call to drive.files.list failed with error")) {
      // This is for cases where Drive is defined but the API call itself failed (e.g., permission issue)
      userMessage = `Apps Scriptプロジェクトの取得に失敗しました。Drive API (Advanced Service) がこのApps Scriptプロジェクトで有効になっているか、およびappsscript.jsonに適切なOAuthスコープ (https://www.googleapis.com/auth/drive.readonly) が設定されているか確認してください。エラー: ${e.message}`;
    }
    return { status: 'error', message: userMessage };
  }
}

/**
 * 指定されたApps Scriptの編集者URLを生成します。
 * @param {string} scriptId - 編集者URLを生成するApps ScriptのID
 * @returns {string} - Apps Scriptの編集者URL
 */
function getScriptEditorUrl(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return "エラー: スクリプトIDが指定されていません。";
  }
  return `https://script.google.com/d/${scriptId}/edit`;
}

/**
 * Adds a new Apps Script library dependency to the target script's appsscript.json.
 *
 * @param {string} targetScriptId - The ID of the script to modify.
 * @param {string} libraryScriptId - The Script ID of the library to add.
 * @param {string} libraryVersion - The version of the library (e.g., "1", "HEAD"). Can be an empty string for HEAD.
 * @returns {object} - Result object with status and message.
 */
function addLibraryToProject(targetScriptId, libraryScriptId, libraryVersion) {
  if (!targetScriptId || targetScriptId.trim() === '') {
    return { status: 'error', message: '対象のスクリプトIDが指定されていません。' };
  }
  if (!libraryScriptId || libraryScriptId.trim() === '') {
    return { status: 'error', message: 'ライブラリのスクリプトIDが指定されていません。' };
  }

  // Default to 'HEAD' if version is empty or not provided
  const effectiveVersion = libraryVersion.trim() === '' ? 'HEAD' : libraryVersion.trim();

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${targetScriptId}/content`;

    // 1. Get current appsscript.json content
    console.log(`スクリプトID ${targetScriptId} の現在の内容を取得中...`);
    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);

    if (getResponse.getResponseCode() !== 200) {
      const errorDetails = JSON.parse(getResponse.getContentText() || '{}');
      console.error("スクリプト内容の取得に失敗しました:", getResponse.getContentText());
      return { status: 'error', message: `スクリプト内容の取得に失敗: ${errorDetails.error?.message || getResponse.getContentText()}` };
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    let appsscriptJsonFile = projectContent.files.find(file => file.name === 'appsscript' && file.type === 'JSON');

    if (!appsscriptJsonFile) {
      return { status: 'error', message: '対象スクリプトにappsscript.jsonファイルが見つかりませんでした。' };
    }

    let manifest = JSON.parse(appsscriptJsonFile.source);

    // Ensure dependencies and dependencies.libraries exist
    if (!manifest.dependencies) {
      manifest.dependencies = {};
    }
    if (!manifest.dependencies.libraries) {
      manifest.dependencies.libraries = [];
    }

    // Check for existing library to prevent duplicates
    const existingLibraryIndex = manifest.dependencies.libraries.findIndex(
      lib => lib.libraryId === libraryScriptId
    );

    if (existingLibraryIndex !== -1) {
      // If found, update version if different, otherwise notify it already exists
      const existingLib = manifest.dependencies.libraries[existingLibraryIndex];
      if (existingLib.version !== effectiveVersion) {
        existingLib.version = effectiveVersion;
        appsscriptJsonFile.source = JSON.stringify(manifest, null, 2); // Prettify output
        console.log(`既存のライブラリ '${libraryScriptId}' のバージョンを '${effectiveVersion}' に更新します。`);
        // Proceed to update the project content
      } else {
        return { status: 'success', message: `ライブラリ '${libraryScriptId}' (バージョン: ${effectiveVersion}) は既に追加されています。` };
      }
    } else {
      // Add new library
      manifest.dependencies.libraries.push({
        libraryId: libraryScriptId,
        version: effectiveVersion,
        userSymbol: 'lib_' + libraryScriptId.substring(0, 8) // Use first 8 chars for user symbol
      });
      appsscriptJsonFile.source = JSON.stringify(manifest, null, 2); // Prettify output
      console.log(`新しいライブラリ '${libraryScriptId}' (バージョン: ${effectiveVersion}) を追加します。`);
    }

    // Prepare files array for updateContent - only include appsscript.json for modification
    const filesToUpdate = projectContent.files.map(file => {
      if (file.name === 'appsscript' && file.type === 'JSON') {
        return appsscriptJsonFile; // Return the modified appsscript.json
      }
      return file; // Return other files as is (their source won't be changed)
    });
    
    // Construct the payload for updateContent
    const updatePayload = { files: filesToUpdate };

    // 2. Update the project content (appsscript.json)
    console.log(`スクリプトID ${targetScriptId} のappsscript.jsonを更新中...`);
    const putOptions = { method: 'put', headers: { 'Authorization': `Bearer ${accessToken}` }, contentType: 'application/json', payload: JSON.stringify(updatePayload), muteHttpExceptions: true };
    const putResponse = UrlFetchApp.fetch(contentUrl, putOptions);

    if (putResponse.getResponseCode() !== 200) {
      const errorDetails = JSON.parse(putResponse.getContentText() || '{}');
      console.error("appsscript.jsonの更新に失敗しました:", putResponse.getContentText());
      return { 
        status: 'error', 
        message: `appsscript.jsonの更新に失敗しました: ${errorDetails.error?.message || putResponse.getContentText()}`, 
        apiErrorDetails: errorDetails,
        fullErrorText: putResponse.getContentText()
      };
    }

    return { status: 'success', message: `ライブラリ '${libraryScriptId}' (バージョン: ${effectiveVersion}) が対象スクリプトに追加（または更新）されました。` };

  } catch (error) {
    console.error("ライブラリ追加中にエラーが発生しました:", error);
    return { status: 'error', message: `ライブラリ追加エラー: ${error.message}` };
  }
}

/**
 * Lists all script versions for a given Apps Script project.
 * @param {string} scriptId - The ID of the Apps Script project.
 * @returns {object} An object containing 'status' and either 'versions' (Array<object>) or 'message'.
 */
function listScriptVersions(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return { status: 'error', message: 'スクリプトIDが指定されていません。' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const versionsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;

    console.log(`スクリプトID ${scriptId} のバージョンをリスト中...`);
    const options = {
      method: 'get',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      muteHttpExceptions: true
    };
    const response = UrlFetchApp.fetch(versionsApiUrl, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode !== 200) {
      console.error(`バージョン取得APIエラー (ステータス: ${responseCode}): ${responseBody}`);
      return { status: 'error', message: `バージョン取得エラー (HTTP ${responseCode}): ${responseBody}` };
    }

    const versionsData = JSON.parse(responseBody);
    if (!versionsData.versions || versionsData.versions.length === 0) {
      return { status: 'success', versions: [], message: 'このスクリプトにはバージョンが見つかりませんでした。' };
    }

    const versions = versionsData.versions.map(v => ({
      versionNumber: v.versionNumber,
      createTime: v.createTime,
      description: v.description || '説明なし'
    })).sort((a, b) => b.versionNumber - a.versionNumber); // 最新のバージョンが上位に来るようにソート

    return { status: 'success', versions: versions };

  } catch (e) {
    console.error("バージョン取得中にエラーが発生しました:", e);
    return { status: 'error', message: `バージョン取得エラー: ${e.message}` };
  }
}

/**
 * Reverts the Apps Script project content to a specific version.
 * This fetches the content of the specified version and then updates the current HEAD with it.
 * @param {string} scriptId - The ID of the Apps Script project.
 * @param {number} versionNumber - The version number to revert to.
 * @returns {object} An object containing 'status' and 'message'.
 */
function revertToVersion(scriptId, versionNumber) {
  if (!scriptId || scriptId.trim() === '') {
    return { status: 'error', message: 'スクリプトIDが指定されていません。' };
  }
  if (typeof versionNumber !== 'number' || versionNumber <= 0) {
    return { status: 'error', message: '有効なバージョン番号が指定されていません。' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const targetVersionContentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions/${versionNumber}`;
    const currentContentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    // 1. 指定されたバージョンのコンテンツを取得する
    console.log(`バージョン ${versionNumber} のコンテンツを取得中...`);
    const getVersionContentOptions = {
      method: 'get',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      muteHttpExceptions: true
    };
    const getVersionContentResponse = UrlFetchApp.fetch(targetVersionContentUrl, getVersionContentOptions);
    const getVersionContentCode = getVersionContentResponse.getResponseCode();
    const getVersionContentBody = getVersionContentResponse.getContentText();

    if (getVersionContentCode !== 200) {
      console.error(`指定バージョンコンテンツ取得APIエラー (ステータス: ${getVersionContentCode}): ${getVersionContentBody}`);
      return { status: 'error', message: `バージョン ${versionNumber} のコンテンツ取得エラー (HTTP ${getVersionContentCode}): ${getVersionContentBody}` };
    }
    const versionContent = JSON.parse(getVersionContentBody);
    if (!versionContent.files) {
      throw new Error(`バージョン ${versionNumber} のコンテンツにファイルデータが見つかりませんでした。`);
    }

    // 2. 取得したファイルコンテンツで現在のHEADを更新する (PUT)
    console.log(`現在のスクリプトをバージョン ${versionNumber} の内容で更新中...`);
    const putContentPayload = { files: versionContent.files };
    const putContentOptions = {
      method: 'put',
      contentType: 'application/json',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      payload: JSON.stringify(putContentPayload),
      muteHttpExceptions: true
    };
    const putContentResponse = UrlFetchApp.fetch(currentContentUrl, putContentOptions);
    const putContentCode = putContentResponse.getResponseCode();
    const putContentBody = putContentResponse.getContentText();

    if (putContentCode !== 200) {
      console.error(`スクリプト更新APIエラー (ステータス: ${putContentCode}): ${putContentBody}`);
      return { status: 'error', message: `スクリプトをバージョン ${versionNumber} に戻す際にエラーが発生しました (HTTP ${putContentCode}): ${putContentBody}` };
    }

    return { status: 'success', message: `スクリプトは正常にバージョン ${versionNumber} に戻されました。` };

  } catch (e) {
    console.error("バージョンへの復元中にエラーが発生しました:", e);
    return { status: 'error', message: `バージョン復元エラー: ${e.message}` };
  }
}
