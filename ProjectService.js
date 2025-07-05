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
        return { status: 'error', message: `Failed to retrieve script content again: ${getResponse.getContentText()}`, apiErrorDetails: JSON.parse(getResponse.getContentText() || '{}') };
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
            message: `Failed to update script. (HTTP ${putResponse.getResponseCode()})`,
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
      message: `Script (ID: ${scriptId}) updated successfully. AI's proposal has been applied.`,
      deploymentStatus: deployResult ? deployResult.status : 'not_attempted',
      deploymentMessage: deployResult ? deployResult.message : 'Auto-deploy was not executed.',
      deploymentId: deployResult ? deployResult.deploymentId : null,
      webappUrl: deployResult ? deployResult.webappUrl : null
    };

  } catch (error) {
    console.error("スクリプト適用中にエラーが発生しました:", error);
    return { status: 'error', message: `Script application error: ${error.message}` };
  }
}

/**
 * Google Cloud PlatformプロジェクトIDを設定します。
 * @param {string} gcpProjectId - 設定するGCPプロジェクトID
 * @returns {object} - 処理結果 (成功/失敗) を示すオブジェクト
 */
function setGcpProjectId(gcpProjectId) {
  if (!gcpProjectId || gcpProjectId.trim() === '') {
    return { status: 'error', message: 'GCP Project ID cannot be empty.' };
  }
  try {
    PropertiesService.getScriptProperties().setProperty('GCP_PROJECT_ID', gcpProjectId.trim());
    return { status: 'success', message: `GCP Project ID '${gcpProjectId.trim()}' set successfully.` };
  } catch (e) {
    console.error("GCPプロジェクトIDの設定中にエラーが発生しました:", e);
    return { status: 'error', message: `GCP Project ID setting error: ${e.message}` };
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
        throw new Error(`Failed to retrieve current script metadata: ${metadataResponse.getContentText()}`);
      }
      const metadata = JSON.parse(metadataResponse.getContentText());

      if (!metadata || typeof metadata.name !== 'string' || !metadata.name.startsWith('projects/')) {
        console.error("Received metadata:", JSON.stringify(metadata, null, 2));
        const userGuidance = "Could not identify the GCP Project ID for the script. This can happen if the current Apps Script project is not linked to a standard Google Cloud project. Please explicitly link a Google Cloud Platform project from the Apps Script editor's 'Project settings' (gear icon) or set it manually in the web UI.";
        throw new Error(userGuidance);
      }

      const gcpProjectIdMatch = metadata.name.match(/^projects\/([^\/]+)\/scripts\/.+$/);
      if (!gcpProjectIdMatch || !gcpProjectIdMatch[1]) {
        throw new Error("Could not correctly extract the current script's GCP Project ID from metadata.");
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
      throw new Error(`Cloud Logging API error (Status: ${responseCode}): ${responseBody}`);
    }

    const logsData = JSON.parse(responseBody);
    if (!logsData.entries || logsData.entries.length === 0) {
      return "No Apps Script logs found for the specified Script ID, or across the GCP project.\n";
    }

    let formattedLogs = "--- Latest Logs ---\n";
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
    return `Log retrieval error: ${e.message}`;
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
    // --- START: Version Cleanup Logic --- (新しいバージョン作成前に古いバージョンをクリーンアップ)
    console.log("古いバージョンをクリーンアップする必要があるか確認中...");
    const VERSION_CLEANUP_THRESHOLD = 195; // 最新のN個のバージョンを保持する (Google Apps Scriptのバージョン上限は200)

    // 1. 全バージョンを取得
    const allVersionsResponse = UrlFetchApp.fetch(versionsApiUrl, { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true });
    if (allVersionsResponse.getResponseCode() !== 200) {
      console.warn(`全バージョン取得に失敗したため、バージョンクリーンアップをスキップします。エラー: ${allVersionsResponse.getContentText()}`);
    } else {
      const allVersionsData = JSON.parse(allVersionsResponse.getContentText());
      // バージョン番号で昇順にソート（最も古いものが最初に来るように）
      let allVersions = (allVersionsData.versions || []).sort((a, b) => a.versionNumber - b.versionNumber);

      // 2. 全デプロイメントを取得し、アクティブなデプロイメントに紐づくバージョンを特定
      const allDeploymentsResponse = UrlFetchApp.fetch(deploymentsApiUrl, { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true });
      const activeDeployedVersions = new Set();

      if (allDeploymentsResponse.getResponseCode() !== 200) {
        console.warn(`アクティブなバージョンを特定するためのデプロイメント取得に失敗しました。エラー: ${allDeploymentsResponse.getContentText()}。クリーンアップは続行しますが、アクティブなバージョンを除外できない可能性があります。`);
      } else {
        const allDeploymentsData = JSON.parse(allDeploymentsResponse.getContentText());
        (allDeploymentsData.deployments || []).forEach(d => {
            if (d.versionNumber) {
                // WebアプリまたはAPI実行可能ファイルに紐づくデプロイメントの場合、そのバージョンをアクティブとマーク
                if (d.entryPoints && Array.isArray(d.entryPoints)) {
                    const isActiveEntryPoint = d.entryPoints.some(ep => 
                        ep.entryPointType === 'WEB_APP' || ep.entryPointType === 'API_EXECUTABLE'
                    );
                    if (isActiveEntryPoint) {
                        activeDeployedVersions.add(d.versionNumber);
                    }
                }
            }
        });
      }

      console.log(`現在のバージョン数: ${allVersions.length}`);
      console.log(`アクティブなデプロイメントに紐づくバージョン: ${Array.from(activeDeployedVersions).join(', ')}`);

      // 削除対象のバージョンを特定
      let versionsToDelete = [];
      if (allVersions.length > VERSION_CLEANUP_THRESHOLD) {
        // 古い方から順に、保持する数を超えたバージョンを対象とする
        const numberOfVersionsToCull = allVersions.length - VERSION_CLEANUP_THRESHOLD;
        for (let i = 0; i < numberOfVersionsToCull; i++) {
            const version = allVersions[i]; // 最も古いバージョンから順に処理
            // アクティブなデプロイメントに紐づいていない場合のみ削除対象とする
            if (!activeDeployedVersions.has(version.versionNumber)) {
                versionsToDelete.push(version);
            } else {
                console.log(`バージョン ${version.versionNumber} (作成日時: ${version.createTime}) はアクティブなデプロイメントに紐づいているため保持します。`);
            }
        }
      }

      if (versionsToDelete.length > 0) {
        console.log(`古いバージョンを ${versionsToDelete.length} 個削除します。`);
        let deletedCount = 0;
        for (const version of versionsToDelete) {
          console.log(`バージョン ${version.versionNumber} を削除中...`);
          const deleteVersionUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions/${version.versionNumber}`;
          const deleteOptions = { method: 'delete', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
          const deleteResponse = UrlFetchApp.fetch(deleteVersionUrl, deleteOptions);

          if (deleteResponse.getResponseCode() !== 200) {
            console.warn(`バージョン ${version.versionNumber} の削除に失敗 (HTTP ${deleteResponse.getResponseCode()}): ${deleteResponse.getContentText()}`);
            if (deleteResponse.getContentText().includes("This version cannot be deleted as it is a currently deployed version.")) {
                console.warn(`注: バージョン ${version.versionNumber} はデプロイ済みのため削除できませんでした。このバージョンはアクティブなデプロイメントに紐づいていると判断されます。`);
                activeDeployedVersions.add(version.versionNumber); // APIがデプロイ済みと明示した場合、念のためアクティブリストに追加
            }
          } else {
            console.log(`バージョン ${version.versionNumber} を正常に削除しました。`);
            deletedCount++;
          }
        }
        console.log(`${deletedCount} 個の古いバージョンを削除しました。`);
      } else {
        console.log("削除対象の古いバージョンはありませんでした。または、すべてアクティブなデプロイメントに紐づいています。現在のバージョン数: " + allVersions.length);
      }
    }
    // --- END: Version Cleanup Logic ---

    // --- START: 新しいデプロイメントの前に、古いウェブアプリデプロイメントをアーカイブ --- (既存のデプロイメントクリーンアップ)
    console.log("新しいデプロイメントの前に、古いウェブアプリデプロイメントをアーカイブする必要があるか確認中...");
    const DEPLOYMENT_LIMIT = 20; // Google Apps Scriptのデプロイメント上限

    const listDeploymentsUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;
    const listOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const listResponse = UrlFetchApp.fetch(listDeploymentsUrl, listOptions);
    const listResponseBody = listResponse.getContentText();

    if (listResponse.getResponseCode() !== 200) {
      console.warn(`既存デプロイメントのリスト取得に失敗しましたが、新しいデプロイメントは続行されます。エラー: ${listResponseBody}`);
    } else {
      const allDeployments = JSON.parse(listResponseBody).deployments || [];
      // Webアプリデプロイメントのみをフィルタリング
      const webAppDeployments = allDeployments.filter(dep => 
          dep.entryPoints && Array.isArray(dep.entryPoints) && 
          dep.entryPoints.some(ep => ep.entryPointType === 'WEB_APP')
      );
      
      console.log(`現在のウェブアプリデプロイメント数: ${webAppDeployments.length}`);

      // 新しいデプロイメントのために空きを作るために削除する必要があるWebアプリデプロイメントの数を計算
      // 目標は DEPLOYMENT_LIMIT - 1 にすることです。
      const deploymentsToRemoveCount = webAppDeployments.length - (DEPLOYMENT_LIMIT - 1);

      if (deploymentsToRemoveCount > 0) {
        console.log(`ウェブアプリデプロイメント数が上限 (${DEPLOYMENT_LIMIT}) に近づいています (${webAppDeployments.length}個)。最も古い ${deploymentsToRemoveCount} 個のウェブアプリデプロイメントをアーカイブします。`);
        
        // 作成時間でソート（最も古いものが最初）
        webAppDeployments.sort((a, b) => new Date(a.createTime).getTime() - new Date(b.createTime).getTime());

        let removedCount = 0;
        // 最も古い 'deploymentsToRemoveCount' 個のWebアプリデプロイメントを削除
        for (let i = 0; i < deploymentsToRemoveCount && i < webAppDeployments.length; i++) {
          const oldDeploymentToDelete = webAppDeployments[i];

          console.log(`古いウェブアプリデプロイメントを削除中: ID = ${oldDeploymentToDelete.deploymentId}, 作成日時 = ${oldDeploymentToDelete.createTime}`);
          const deleteDeploymentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments/${oldDeploymentToDelete.deploymentId}`;
          const deleteOptions = { method: 'delete', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
          const deleteResponse = UrlFetchApp.fetch(deleteDeploymentUrl, deleteOptions);

          if (deleteResponse.getResponseCode() !== 200) {
            console.warn(`古いデプロイメント ${oldDeploymentToDelete.deploymentId} の削除に失敗: ${deleteResponse.getContentText()}`);
            if (deleteResponse.getContentText().includes("Read-only deployments may not be deleted.")) {
                console.warn(`注: デプロイメント ${oldDeploymentToDelete.deploymentId} は読み取り専用のため削除できませんでした。`);
            }
          } else {
            console.log(`古いデプロイメント ${oldDeploymentToDelete.deploymentId} を正常に削除しました。`);
            removedCount++;
          }
        }
        if (removedCount > 0) {
          console.log(`${removedCount} 個の古いウェブアプリデプロイメントを削除しました。`);
        } else {
          console.log("削除可能な古いウェブアプリデプロイメントが見つからなかったか、全て削除に失敗しました。利用可能なデプロイメントはすべて読み取り専用である可能性があります。");
        }
      } else {
        console.log(`ウェブアプリデプロイメント数が上限 (${DEPLOYMENT_LIMIT}) 未満のため、古いデプロイメントのアーカイブはスキップします。`);
      }
    }
    // --- END: 新しいデプロイメントの前に、古いウェブアプリデプロイメントをアーカイブ ---

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
      throw new Error(`Version creation API error (Status: ${createVersionResponseCode}): ${createVersionResponseBody}`);
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
      throw new Error(`Deployment API error (Status: ${responseCode}): ${responseBody}`);
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

    if (!webappUrl) {
      console.warn("ウェブアプリのURLがデプロイ応答で見つかりませんでした。デプロイ結果全体:", JSON.stringify(deploymentResult, null, 2));
      return {
        status: 'success',
        message: 'Deployment completed successfully, but the web app URL was not found. Please verify the deployment settings in appsscript.json.',
        deploymentId: newDeploymentId,
        webappUrl: null
      };
    }

    return {
      status: 'success',
      message: 'Deployment completed successfully.',
      deploymentId: newDeploymentId,
      webappUrl: webappUrl
    };

  } catch (e) {
    console.error("デプロイ中にエラーが発生しました:", e);
    return { status: 'error', message: `Deployment error: ${e.message}` };
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
    let userMessage = `Apps Script project list error: ${e.message}`;

    if (e.name === 'ReferenceError' && e.message.includes("Drive is not defined")) {
      userMessage = `Failed to retrieve Apps Script projects. Drive API (Advanced Service) might not be enabled for this Apps Script project. Please enable 'Drive API' from 'Project settings' (gear icon) > 'Advanced Google Services' in the Apps Script editor and ensure it's linked to this project. Also, confirm that the appropriate OAuth scope (https://www.googleapis.com/auth/drive.readonly) is set in appsscript.json.`;
    } else if (e.message.includes("API call to drive.files.list failed with error")) {
      // This is for cases where Drive is defined but the API call itself failed (e.g., permission issue)
      userMessage = `Failed to retrieve Apps Script projects. Please confirm that Drive API (Advanced Service) is enabled for this Apps Script project and that the appropriate OAuth scope (https://www.googleapis.com/auth/drive.readonly) is set in appsscript.json. Error: ${e.message}`;
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
    return "Error: Script ID is not specified.";
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
    return { status: 'error', message: 'Target script ID is not specified.' };
  }
  if (!libraryScriptId || libraryScriptId.trim() === '') {
    return { status: 'error', message: 'Library Script ID is not specified.' };
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
      return { status: 'error', message: `Failed to retrieve script content: ${errorDetails.error?.message || getResponse.getContentText()}` };
    }
    const projectContent = JSON.parse(getResponse.getContentText());

    let appsscriptJsonFile = projectContent.files.find(file => file.name === 'appsscript' && file.type === 'JSON');

    if (!appsscriptJsonFile) {
      return { status: 'error', message: 'appsscript.json file not found in the target script.' };
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
        return { status: 'success', message: `Library '${libraryScriptId}' (Version: ${effectiveVersion}) is already added.` };
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
        message: `Failed to update appsscript.json: ${errorDetails.error?.message || putResponse.getContentText()}`, 
        apiErrorDetails: errorDetails,
        fullErrorText: putResponse.getContentText()
      };
    }

    return { status: 'success', message: `Library '${libraryScriptId}' (Version: ${effectiveVersion}) has been added to (or updated in) the target script.` };

  } catch (error) {
    console.error("ライブラリ追加中にエラーが発生しました:", error);
    return { status: 'error', message: `Library addition error: ${error.message}` };
  }
}

/**
 * Lists all script versions for a given Apps Script project,
 * and also includes associated web app deployment URLs.
 * @param {string} scriptId - The ID of the Apps Script project.
 * @returns {object} An object containing 'status' and either 'versions' (Array<object>) or 'message'.
 */
function listScriptVersions(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return { status: 'error', message: 'Script ID is not specified.' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const versionsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;
    const deploymentsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;

    // 1. Fetch all versions
    console.log(`スクリプトID ${scriptId} のバージョンをリスト中...`);
    const versionOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const versionResponse = UrlFetchApp.fetch(versionsApiUrl, versionOptions);
    const versionResponseCode = versionResponse.getResponseCode();
    const versionResponseBody = versionResponse.getContentText();

    if (versionResponseCode !== 200) {
      console.error(`バージョン取得APIエラー (ステータス: ${versionResponseCode}): ${versionResponseBody}`);
      return { status: 'error', message: `Version retrieval error (HTTP ${versionResponseCode}): ${versionResponseBody}` };
    }

    const versionsData = JSON.parse(versionResponseBody);
    let versions = (versionsData.versions || []).map(v => ({
      versionNumber: v.versionNumber,
      createTime: v.createTime,
      description: v.description || '説明なし',
      webappUrl: null // Initialize webappUrl
    }));

    // 2. Fetch all deployments to find web app URLs
    console.log(`スクリプトID ${scriptId} のデプロイメントをリスト中...`);
    const deploymentOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const deploymentResponse = UrlFetchApp.fetch(deploymentsApiUrl, deploymentOptions);
    const deploymentResponseCode = deploymentResponse.getResponseCode();
    const deploymentResponseBody = deploymentResponse.getContentText();

    if (deploymentResponseCode !== 200) {
      console.warn(`デプロイメント取得APIエラー (ステータス: ${deploymentResponseCode})。ウェブアプリURLは取得できませんでした: ${deploymentResponseBody}`);
      // Continue without web app URLs if deployment fetch fails
    } else {
      const deploymentsData = JSON.parse(deploymentResponseBody);
      const webAppUrlMap = {}; // Map to store versionNumber -> webAppUrl

      (deploymentsData.deployments || []).forEach(d => {
        if (d.entryPoints && Array.isArray(d.entryPoints)) {
          d.entryPoints.forEach(ep => {
            if (ep.entryPointType === 'WEB_APP' && ep.webApp && ep.webApp.url) {
              const deployedVersion = d.versionNumber;
              // If multiple web apps for the same version, just take the first one found (or latest if list is sorted by createTime)
              if (deployedVersion && !webAppUrlMap[deployedVersion]) {
                webAppUrlMap[deployedVersion] = ep.webApp.url;
              } else if (deployedVersion && webAppUrlMap[deployedVersion]) {
                // If a web app URL for this version already exists, prioritize the latest one if available (API's default sort order for deployments)
                // Or, simply overwrite to take the last one found in the list.
                webAppUrlMap[deployedVersion] = ep.webApp.url;
              }
            }
          });
        }
      });

      // 3. Enrich versions with web app URLs
      versions = versions.map(v => {
        if (webAppUrlMap[v.versionNumber]) {
          v.webappUrl = webAppUrlMap[v.versionNumber];
        }
        return v;
      });
    }

    // Sort versions by versionNumber descending (latest first)
    versions.sort((a, b) => b.versionNumber - a.versionNumber);

    return { status: 'success', versions: versions, message: 'Versions retrieved successfully.' };

  } catch (e) {
    console.error("バージョン取得中にエラーが発生しました:", e);
    return { status: 'error', message: `Version retrieval error: ${e.message}` };
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
    return { status: 'error', message: 'Script ID is not specified.' };
  }
  if (typeof versionNumber !== 'number' || versionNumber <= 0) {
    return { status: 'error', message: 'A valid version number is not specified.' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    // 特定のバージョンのコンテンツを取得するためのエンドポイントを/versions/{versionNumber}から
    // /content?versionNumber={versionNumber}に変更
    const getContentForVersionUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content?versionNumber=${versionNumber}`;
    const currentContentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    // 1. 指定されたバージョンのコンテンツを取得する
    console.log(`バージョン ${versionNumber} のコンテンツを取得中...`);
    const getVersionContentOptions = {
      method: 'get',
      headers: { 'Authorization': `Bearer ${accessToken}` },
      muteHttpExceptions: true
    };
    const getVersionContentResponse = UrlFetchApp.fetch(getContentForVersionUrl, getVersionContentOptions);
    const getVersionContentCode = getVersionContentResponse.getResponseCode();
    const getVersionContentBody = getVersionContentResponse.getContentText();

    if (getVersionContentCode !== 200) {
      console.error(`指定バージョンコンテンツ取得APIエラー (ステータス: ${getVersionContentCode}): ${getVersionContentBody}`);
      return { status: 'error', message: `Failed to retrieve content for version ${versionNumber} (HTTP ${getVersionContentCode}): ${getVersionContentBody}` };
    }
    const versionContent = JSON.parse(getVersionContentBody);
    // Modified: Check if 'files' property is missing or empty, and return a more specific error.
    if (!versionContent.files || !Array.isArray(versionContent.files) || versionContent.files.length === 0) {
      console.error(`バージョン ${versionNumber} のコンテンツにファイルデータが見つからないか、空でした。受信した応答ボディ: ${getVersionContentBody}`);
      return {
        status: 'error',
        message: `Version ${versionNumber} content is empty or malformed (no files data). This version cannot be reverted to. Please check the Apps Script project's version history in the editor for details.`,
        apiResponse: getVersionContentBody
      };
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
      return { status: 'error', message: `Error reverting script to version ${versionNumber} (HTTP ${putContentCode}): ${putContentBody}` };
    }

    return { status: 'success', message: `Script successfully reverted to version ${versionNumber}.` };

  } catch (e) {
    console.error("バージョンへの復元中にエラーが発生しました:", e);
    return { status: 'error', message: `Version reversion error: ${e.message}` };
  }
}

/**
 * 指定されたApps Scriptプロジェクトのファイル一覧（ファイル名とタイプ）を取得します。
 * @param {string} scriptId - ファイル一覧を取得するApps ScriptのID
 * @returns {object} - 処理結果 (成功/失敗) とファイル一覧 (成功時) を示すオブジェクト
 */
function listTargetScriptFiles(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return { status: 'error', message: 'Script ID is not specified.' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    console.log(`スクリプトID ${scriptId} のファイル内容を取得中...`);
    const getOptions = { method: 'get', headers: { 'Authorization': `Bearer ${accessToken}` }, muteHttpExceptions: true };
    const getResponse = UrlFetchApp.fetch(contentUrl, getOptions);
    const responseCode = getResponse.getResponseCode();
    const responseBody = getResponse.getContentText();

    if (responseCode !== 200) {
        console.error(`Apps Script APIエラー (ファイル内容取得) - ステータス: ${responseCode}, ボディ: ${responseBody}`);
        return { status: 'error', message: `Failed to retrieve script content: ${responseBody}`, apiErrorDetails: JSON.parse(responseBody || '{}') };
    }
    
    const projectContent = JSON.parse(responseBody);
    
    // 必要な情報（nameとtype）のみを抽出して返す
    const filesList = (projectContent.files || []).map(file => ({
      name: file.name,
      type: file.type
    }));

    return { status: 'success', files: filesList, message: `Successfully retrieved ${filesList.length} files.` };

  } catch (error) {
    console.error("ファイル一覧取得中にエラーが発生しました:", error);
    return { status: 'error', message: `File list retrieval error: ${error.message}` };
  }
}
