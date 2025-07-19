/**
 * Applies changes proposed by AI to the script files.
 * @param {string} scriptId - The ID of the script to update.
 * @param {Array<object>} proposedFiles - Array of file objects (new or modified source, or REPLACE operations).
 * @param {Array<string>} deletedFileNames - Array of file names to be deleted.
 * @param {boolean} autoDeploy - Whether to automatically deploy after applying changes.
 * @param {string} proposalPurpose - The purpose of the changes proposed by the AI.
 * @returns {object} - Object indicating the success or failure of the operation.
 */
function applyProposedChanges(scriptId, proposedFiles, deletedFileNames, autoDeploy, proposalPurpose) {
  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    // 1. Retrieve current script content
    console.log(`Retrieving current script content for ID: ${scriptId}`);
    const getResponse = _makeApiCall(contentUrl, 'get', accessToken, null, 'Failed to retrieve script content for update');
    const originalProjectContent = JSON.parse(getResponse.getContentText());
    
    // Initialize map with current files, ready for updates/deletions
    const newProjectFilesMap = new Map(originalProjectContent.files.map(f => [f.name, f]));

    // Apply proposed changes to the map (update existing or add new)
    for (const proposedFile of proposedFiles) {
      _applyFileChangeToMap(newProjectFilesMap, proposedFile);
    }

    // Remove files marked for deletion from the map
    _deleteFilesFromMap(newProjectFilesMap, deletedFileNames, originalProjectContent.files);
    
    // Convert map to array for the final PUT payload
    let finalFilesForPutPayload = Array.from(newProjectFilesMap.values());
    
    // Ensure appsscript.json is always present, even if AI's proposal somehow removes it
    finalFilesForPutPayload = _ensureAppsscriptJsonFallback(finalFilesForPutPayload, originalProjectContent.files);

    const finalPayload = { files: finalFilesForPutPayload };
    
    // 2. Update the script content with the final file list
    console.log(`Updating script content for ID: ${scriptId}`);
    const putResponse = _makeApiCall(contentUrl, 'put', accessToken, JSON.stringify(finalPayload), 'Failed to update script');

    let deployResult = null;
    if (autoDeploy) {
      console.log(`Initiating automatic deployment for Script ID: ${scriptId}`);
      deployResult = deployScript(scriptId, proposalPurpose);
      console.log("Automatic deployment result:", JSON.stringify(deployResult, null, 2));
    }

    let successMessage = `Script (ID: ${scriptId}) updated successfully. AI's proposal has been applied.`;

    return {
      status: 'success',
      message: successMessage,
      deploymentStatus: deployResult ? deployResult.status : 'not_attempted',
      deploymentMessage: deployResult ? deployResult.message : 'Auto-deploy was not executed.',
      deploymentId: deployResult ? deployResult.deploymentId : null,
      webappUrl: deployResult ? deployResult.webappUrl : null
    };

  } catch (error) {
    console.error("Error applying script changes:", error);
    return { status: 'error', message: `Script application error: ${error.message}`, apiErrorDetails: error.apiErrorDetails || null, fullErrorText: error.fullErrorText || null };
  }
}

/**
 * Internal helper to make an authenticated Apps Script API call.
 * @param {string} url - The URL to fetch.
 * @param {'get'|'post'|'put'|'delete'} method - The HTTP method.
 * @param {string} accessToken - OAuth token.
 * @param {string} [payload] - JSON payload for POST/PUT requests.
 * @param {string} errorMessagePrefix - Prefix for error messages.
 * @returns {GoogleAppsScript.URL_Fetch.HTTPResponse} The successful response.
 * @throws {Error} If the API call fails.
 */
function _makeApiCall(url, method, accessToken, payload = null, errorMessagePrefix = 'API call failed') {
  const options = {
    method: method,
    headers: { 'Authorization': `Bearer ${accessToken}` },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = payload;
  }

  const response = UrlFetchApp.fetch(url, options);
  const responseCode = response.getResponseCode();
  if (responseCode !== 200) {
    const errorDetails = JSON.parse(response.getContentText() || '{}');
    const error = new Error(`${errorMessagePrefix} (Status: ${responseCode}): ${errorDetails.error?.message || response.getContentText()}`);
    error.apiErrorDetails = errorDetails;
    error.fullErrorText = response.getContentText();
    throw error;
  }
  return response;
}

/**
 * Applies a single proposed file change (update, add, or replace) to the files map.
 * @param {Map<string, object>} newProjectFilesMap - The map of current project files to update.
 * @param {object} proposedFile - The file object proposed by AI.
 */
function _applyFileChangeToMap(newProjectFilesMap, proposedFile) {
  if (!proposedFile || typeof proposedFile.name !== 'string' || typeof proposedFile.type !== 'string') {
    console.warn("AI response contains a malformed file object. Skipping:", JSON.stringify(proposedFile));
    return;
  }

  if (proposedFile.type === 'REPLACE') {
    const currentFile = newProjectFilesMap.get(proposedFile.name);
    if (!currentFile) {
      console.warn(`REPLACE operation target file '${proposedFile.name}' not found in current project. Skipping.`);
      return;
    }
    if (currentFile.type === 'REPLACE') {
      console.warn(`REPLACE operation target file '${proposedFile.name}' is already marked as REPLACE type. This is unexpected. Skipping.`);
      return;
    }

    const currentSource = currentFile.source;
    const oldString = proposedFile.old_string;
    const newString = proposedFile.new_string;

    if (typeof oldString !== 'string' || typeof newString !== 'string') {
      console.warn(`REPLACE operation for '${proposedFile.name}' has malformed old_string or new_string. Skipping.`);
      return;
    }

    const isGlobalReplace = proposedFile.isGlobalReplace === true;
    let replacementPerformed = false;

    if (isGlobalReplace) {
      if (currentSource.includes(oldString)) {
        currentFile.source = currentSource.replaceAll(oldString, newString);
        console.log(`File '${proposedFile.name}' (Global REPLACE) executed.`);
        replacementPerformed = true;
      }
    } else {
      if (currentSource.includes(oldString)) {
        currentFile.source = currentSource.replace(oldString, newString);
        console.log(`File '${proposedFile.name}' (Single REPLACE) executed.`);
        replacementPerformed = true;
      }
    }

    if (!replacementPerformed) {
      console.warn(`REPLACE operation's old_string not found in file '${proposedFile.name}'. Skipping replacement. Proposed Old String (first 100 chars): "${oldString.substring(0, 100)}"...`);
    }
  } else { // Handle SERVER_JS, JSON, HTML types
    newProjectFilesMap.set(proposedFile.name, proposedFile); // Update existing or add new
  }
}

/**
 * Deletes files from the project files map based on the provided list of file names.
 * @param {Map<string, object>} newProjectFilesMap - The map of project files to modify.
 * @param {Array<string>} deletedFileNames - Array of file names to delete.
 * @param {Array<object>} originalProjectFiles - The original list of files (for logging purposes).
 */
function _deleteFilesFromMap(newProjectFilesMap, deletedFileNames, originalProjectFiles) {
  if (deletedFileNames && Array.isArray(deletedFileNames)) {
    deletedFileNames.forEach(fileName => {
      if (newProjectFilesMap.has(fileName)) {
        newProjectFilesMap.delete(fileName);
        console.log(`File marked for deletion and removed from map: ${fileName}`);
      } else {
        console.warn(`File '${fileName}' was marked for deletion but not found in current map. Skipping deletion.`);
      }
    });
  }
}

/**
 * Ensures that `appsscript.json` is always present in the final payload.
 * This acts as a fallback if AI's proposal somehow omits or deletes it.
 * @param {Array<object>} currentFilesPayload - The array of files prepared for the PUT request.
 * @param {Array<object>} originalProjectFiles - The original files array from the project.
 * @returns {Array<object>} The updated files array including appsscript.json if necessary.
 * @throws {Error} If `appsscript.json` is critically missing and cannot be restored.
 */
function _ensureAppsscriptJsonFallback(currentFilesPayload, originalProjectFiles) {
  const hasAppsscriptJson = currentFilesPayload.some(f => f.name === 'appsscript' && f.type === 'JSON');
  if (!hasAppsscriptJson) {
    const appsscriptJson = originalProjectFiles.find(f => f.name === 'appsscript' && f.type === 'JSON');
    if (appsscriptJson) {
      currentFilesPayload.push(appsscriptJson);
      console.warn("appsscript.json was missing from proposed files; forcibly re-added from original project.");
    } else {
      // This case should ideally not happen if original project is valid, but good for robustness
      throw new Error("Cannot apply changes: appsscript.json not found in original project content. Project would become empty or invalid.");
    }
  }
  if (currentFilesPayload.length === 0) {
     throw new Error("Cannot apply changes: Proposed file list is empty after all operations. At least one file must remain.");
  }
  return currentFilesPayload;
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
 * @param {string} targetScriptId - ログ取得のコンテキストに使用されるApps ScriptのID（ログフィルタリングには使用されません）。
 * @returns {Array<object>|string} - フォーマットされたログオブジェクトの配列、またはエラーメッセージ
 */
function getScriptLogs(targetScriptId) {
  const accessToken = ScriptApp.getOAuthToken();
  const currentScriptId = ScriptApp.getScriptId();

  try {
    let gcpProjectId = PropertiesService.getScriptProperties().getProperty('GCP_PROJECT_ID');

    if (!gcpProjectId) {
      console.log("Script propertiesにGCPプロジェクトIDが見つかりません。メタデータから取得を試みます。");
      const currentScriptMetadataUrl = `https://script.googleapis.com/v1/projects/${currentScriptId}`;
      const metadataResponse = _makeApiCall(currentScriptMetadataUrl, 'get', accessToken, null, 'Failed to retrieve current script metadata');
      
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
      "orderBy": "timestamp desc",
      "pageSize": 50
    };

    console.log(`Retrieving logs from GCP project ${gcpProjectId}...`);
    const response = _makeApiCall(loggingApiUrl, 'post', accessToken, JSON.stringify(requestBody), 'Cloud Logging API error');
    
    const logsData = JSON.parse(response.getContentText());
    if (!logsData.entries || logsData.entries.length === 0) {
      return []; // Return empty array if no logs are found
    }

    const logEntries = [];
    logsData.entries.forEach(entry => {
      const timestamp = new Date(entry.timestamp).toLocaleString();
      let logPayload = '';
      if (entry.textPayload) {
        logPayload = entry.textPayload;
      } else if (entry.jsonPayload) {
        let payload = entry.jsonPayload;
        if (payload && typeof payload.message !== 'undefined') {
          logPayload = typeof payload.message === 'object' ? JSON.stringify(payload.message, null, 2) : String(payload.message);
        } else {
          let tempPayload = { ...payload };
          if (tempPayload.serviceContext) {
            delete tempPayload.serviceContext;
          }
          logPayload = JSON.stringify(tempPayload, null, 2);
        }
      } else if (entry.protoPayload) {
        let payload = entry.protoPayload;
        if (payload && typeof payload.message !== 'undefined') {
          logPayload = typeof payload.message === 'object' ? JSON.stringify(payload.message, null, 2) : String(payload.message);
        } else {
          let tempPayload = { ...payload };
          if (tempPayload.serviceContext) {
            delete tempPayload.serviceContext;
          }
          logPayload = JSON.stringify(tempPayload, null, 2);
        }
      }
      logEntries.push({
        timestamp: timestamp,
        severity: entry.severity || 'INFO',
        message: logPayload
      });
    });

    return logEntries;

  } catch (e) {
    console.error("Error retrieving logs:", e);
    return `Log retrieval error: ${e.message}`;
  }
}

/**
 * Creates a new Apps Script version and deploys it as a new web app.
 * Handles cleanup of old versions and web app deployments if limits are reached.
 * @param {string} scriptId - The ID of the script to deploy.
 * @param {string} description - The deployment description (optional).
 * @returns {object} - Deployment result (success/failure, deployment ID, URL).
 */
function deployScript(scriptId, description = '') {
  console.log("Starting deployScript for Script ID:", scriptId, "Description:", description);
  const accessToken = ScriptApp.getOAuthToken();
  const versionsApiBaseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;
  const deploymentsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;

  try {
    // Cleanup old versions before creating a new one
    _cleanupOldVersions(scriptId, accessToken, versionsApiBaseUrl, deploymentsApiUrl);

    // Cleanup old web app deployments before creating a new one
    _cleanupOldDeployments(scriptId, accessToken, deploymentsApiUrl);

    // 1. Create a new version
    console.log("Creating new script version...");
    const versionResult = _createVersion(scriptId, accessToken, description);
    const versionNumber = versionResult.versionNumber;
    console.log(`New version created: Version ${versionNumber}`);

    // 2. Deploy the new version as a web app
    console.log(`Deploying version ${versionNumber} as a web app...`);
    const deploymentResult = _performDeployment(scriptId, accessToken, deploymentsApiUrl, versionNumber, description);
    const newDeploymentId = deploymentResult.deploymentId;

    let webappUrl = null;
    if (deploymentResult.entryPoints && Array.isArray(deploymentResult.entryPoints) && deploymentResult.entryPoints.length > 0) {
      const webAppEntryPoint = deploymentResult.entryPoints.find(ep => ep.entryPointType === 'WEB_APP');
      if (webAppEntryPoint?.webApp?.url) {
        webappUrl = webAppEntryPoint.webApp.url;
        console.log("Web App URL extracted from entryPoint:", webappUrl);
      } else {
        console.warn("Web App URL not found in deployment response entryPoints.", JSON.stringify(deploymentResult.entryPoints));
      }
    } else {
      console.warn("Deployment response has no entryPoints or an empty array.");
    }

    return {
      status: 'success',
      message: 'Deployment completed successfully.',
      deploymentId: newDeploymentId,
      webappUrl: webappUrl
    };

  } catch (e) {
    console.error("Error during deployment:", e);
    return { status: 'error', message: `Deployment error: ${e.message}`, apiErrorDetails: e.apiErrorDetails || null, fullErrorText: e.fullErrorText || null };
  }
}

/**
 * Internal helper to list all versions of a script, handling pagination.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @returns {Array<object>} List of all versions.
 */
function _listAllVersions(scriptId, accessToken) {
  const versionsApiBaseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;
  let allVersions = [];
  let pageToken = null;
  let hasMore = true;

  while (hasMore) {
    let url = versionsApiBaseUrl + `?pageSize=200`;
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    const response = _makeApiCall(url, 'get', accessToken, null, 'Failed to list script versions for cleanup');
    const pageData = JSON.parse(response.getContentText());
    allVersions = allVersions.concat(pageData.versions || []);
    pageToken = pageData.nextPageToken;
    hasMore = !!pageToken;
  }
  return allVersions;
}

/**
 * Internal helper to list all deployments of a script, handling pagination.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @returns {Array<object>} List of all deployments.
 */
function _listAllDeployments(scriptId, accessToken) {
  const deploymentsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;
  let allDeployments = [];
  let pageToken = null;
  let hasMore = true;

  while (hasMore) {
    let url = deploymentsApiUrl + `?pageSize=100`; // Deployments usually have a smaller limit
    if (pageToken) {
      url += `&pageToken=${pageToken}`;
    }
    const response = _makeApiCall(url, 'get', accessToken, null, 'Failed to list script deployments for cleanup');
    const pageData = JSON.parse(response.getContentText());
    allDeployments = allDeployments.concat(pageData.deployments || []);
    // Log a compact sample instead of full objects to prevent truncation
    console.log(`  _listAllDeployments: Fetched ${pageData.deployments?.length || 0} deployments (page ${pageToken ? 'next' : 'first'}). Sample (first 5 compact):`, JSON.stringify((pageData.deployments || []).slice(0, 5).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));
    pageToken = pageData.nextPageToken;
    hasMore = !!pageToken;
  }
  // Log a compact summary for all deployments retrieved
  console.log(`  _listAllDeployments: All deployments retrieved (total: ${allDeployments.length}). Sample (first 5 compact):`, JSON.stringify(allDeployments.slice(0, 5).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));
  return allDeployments;
}

/**
 * Internal helper to delete a specific script version.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @param {number} versionNumber - The version number to delete.
 */
function _deleteVersion(scriptId, accessToken, versionNumber) {
  const deleteVersionUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions/${versionNumber}`;
  try {
    _makeApiCall(deleteVersionUrl, 'delete', accessToken, null, `Failed to delete version ${versionNumber}`);
    console.log(`Successfully deleted version ${versionNumber}.`);
  } catch (e) {
    console.warn(`Warning: Failed to delete version ${versionNumber}. Error: ${e.message}. This might be a deployed version.`);
  }
}

/**
 * Internal helper to delete a specific script deployment.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @param {string} deploymentId - The ID of the deployment to delete.
 */
function _deleteDeployment(scriptId, accessToken, deploymentId) {
  const deleteDeploymentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments/${deploymentId}`;
  try {
    _makeApiCall(deleteDeploymentUrl, 'delete', accessToken, null, `Failed to delete deployment ${deploymentId}`);
    console.log(`Successfully deleted deployment ${deploymentId}.`);
  } catch (e) {
    console.warn(`Warning: Failed to delete deployment ${deploymentId}. Error: ${e.message}. This might be a read-only deployment.`);
  }
}

/**
 * Internal helper to clean up old script versions.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @param {string} versionsApiBaseUrl - Base URL for versions API.
 * @param {string} deploymentsApiUrl - URL for deployments API.
 */
function _cleanupOldVersions(scriptId, accessToken, versionsApiBaseUrl, deploymentsApiUrl) {
  console.log("Checking for old versions to clean up...");
  const VERSION_CLEANUP_THRESHOLD = 195; // Retain latest N versions (Google Apps Script version limit is 200)

  let allVersions = [];
  try {
    allVersions = _listAllVersions(scriptId, accessToken);
  } catch (e) {
    console.warn(`Failed to retrieve all versions for cleanup. Skipping version cleanup. Error: ${e.message}`);
    return;
  }

  if (allVersions.length === 0) {
    console.log("No versions found for cleanup.");
    return;
  }

  allVersions.sort((a, b) => a.versionNumber - b.versionNumber); // Sort oldest first

  const activeDeployedVersions = new Set();
  try {
    const allDeployments = _listAllDeployments(scriptId, accessToken);
    // Sort deployments by createTime in ascending order (oldest first)
    allDeployments.sort((a, b) => new Date(a.updateTime).getTime() - new Date(b.updateTime).getTime());
    allDeployments.forEach(d => {
      if (d.deploymentConfig && d.deploymentConfig.versionNumber) {
        const isActiveEntryPoint = d.entryPoints?.some(ep => ep.entryPointType === 'WEB_APP' || ep.entryPointType === 'API_EXECUTABLE');
        if (isActiveEntryPoint) {
          activeDeployedVersions.add(d.deploymentConfig.versionNumber);
        }
      }
    });
  } catch (e) {
    console.warn(`Failed to retrieve active deployments for version cleanup. Error: ${e.message}. Cleanup will proceed, but active versions might not be excluded.`);
  }

  console.log(`Current number of versions: ${allVersions.length}`);
  console.log(`Versions linked to active deployments: ${Array.from(activeDeployedVersions).join(', ')}`);

  let versionsToDelete = [];
  if (allVersions.length > VERSION_CLEANUP_THRESHOLD) {
    const numberOfVersionsToCull = allVersions.length - VERSION_CLEANUP_THRESHOLD;
    for (let i = 0; i < numberOfVersionsToCull; i++) {
      const version = allVersions[i];
      if (!activeDeployedVersions.has(version.versionNumber)) {
        versionsToDelete.push(version);
      } else {
        console.log(`Version ${version.versionNumber} (created: ${version.createTime}) is linked to an active deployment, retaining.`);
      }
    }
  }

  if (versionsToDelete.length > 0) {
    console.log(`Deleting ${versionsToDelete.length} old versions.`);
    let deletedCount = 0;
    for (const version of versionsToDelete) {
      _deleteVersion(scriptId, accessToken, version.versionNumber);
      deletedCount++;
    }
    console.log(`${deletedCount} old versions deleted.`);
  } else {
    console.log("No old versions found for deletion or all are actively deployed. Current version count: " + allVersions.length);
  }
}

/**
 * Internal helper to clean up old web app deployments.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @param {string} deploymentsApiUrl - URL for deployments API.
 */
function _cleanupOldDeployments(scriptId, accessToken, deploymentsApiUrl) {
  console.log("Checking for old web app deployments to archive...");
  const DEPLOYMENT_LIMIT = 20; // Google Apps Script deployment limit

  let allDeployments = [];
  try {
    allDeployments = _listAllDeployments(scriptId, accessToken);
  } catch (e) {
    console.warn(`Failed to retrieve existing deployments for cleanup. Skipping deployment cleanup. Error: ${e.message}`);
    return;
  }

  const webAppDeployments = allDeployments.filter(dep => 
    dep.entryPoints?.some(ep => ep.entryPointType === 'WEB_APP')
  );
  // Log a compact summary for web app deployments
  console.log(`  _cleanupOldDeployments: All web app deployments (total: ${webAppDeployments.length}, unsorted). Sample (first 5 compact):`, JSON.stringify(webAppDeployments.slice(0, 5).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));
  
  console.log(`Current number of web app deployments: ${webAppDeployments.length}`);

  const deploymentsToRemoveCount = webAppDeployments.length - (DEPLOYMENT_LIMIT - 1);

  if (deploymentsToRemoveCount > 0) {
    console.log(`Web app deployment count is near limit (${DEPLOYMENT_LIMIT}) - currently ${webAppDeployments.length}. Archiving oldest ${deploymentsToRemoveCount} web app deployments.`);
    
    webAppDeployments.sort((a, b) => new Date(a.updateTime).getTime() - new Date(b.updateTime).getTime());
    // Log a compact sample for sorted web app deployments
    console.log(`  _cleanupOldDeployments: Web app deployments sorted by updateTime (oldest first, total: ${webAppDeployments.length}). Sample (first 5 compact):`, JSON.stringify(webAppDeployments.slice(0, 5).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));

    console.log(`  _cleanupOldDeployments: Proposing to archive ${deploymentsToRemoveCount} oldest web app deployments. These are:`, JSON.stringify(webAppDeployments.slice(0, deploymentsToRemoveCount).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));
    let removedCount = 0;
    for (let i = 0; i < deploymentsToRemoveCount && i < webAppDeployments.length; i++) {
      const oldDeploymentToDelete = webAppDeployments[i];
      _deleteDeployment(scriptId, accessToken, oldDeploymentToDelete.deploymentId);
      removedCount++;
    }
    if (removedCount > 0) {
      console.log(`${removedCount} old web app deployments archived.`);
    } else {
      console.log("No removable old web app deployments found or all deletion attempts failed.");
    }
  } else {
    console.log(`Web app deployment count is below limit (${DEPLOYMENT_LIMIT}), skipping old deployment archiving.`);
  }
}

/**
 * Internal helper to create a new script version.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @param {string} description - Description for the new version.
 * @returns {object} The created version object.
 */
function _createVersion(scriptId, accessToken, description) {
  const versionsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;
  const createVersionPayload = { description: description };
  console.log("Version creation request payload:", JSON.stringify(createVersionPayload));
  const response = _makeApiCall(versionsApiUrl, 'post', accessToken, JSON.stringify(createVersionPayload), 'Version creation API error');
  return JSON.parse(response.getContentText());
}

/**
 * Internal helper to perform the web app deployment.
 * @param {string} scriptId - The ID of the script.
 * @param {string} accessToken - OAuth token.
 * @param {string} deploymentsApiUrl - URL for deployments API.
 * @param {number} versionNumber - The version number to deploy.
 * @param {string} description - Description for the deployment.
 * @returns {object} The created deployment object.
 */
function _performDeployment(scriptId, accessToken, deploymentsApiUrl, versionNumber, description) {
  const deploymentRequestBody = {
    "versionNumber": versionNumber,
    "manifestFileName": "appsscript",
    "description": description
  };
  console.log("Deployment request payload:", JSON.stringify(deploymentRequestBody));
  const response = _makeApiCall(deploymentsApiUrl, 'post', accessToken, JSON.stringify(deploymentRequestBody), 'Deployment API error');
  return JSON.parse(response.getContentText());
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
    console.log("Listing Apps Script projects using Drive API...");
    
    // Filter for Apps Script files that are not trashed
    const query = 'mimeType = "application/vnd.google-apps.script" and trashed = false';
    
    // Fetch files, limit to a reasonable number (e.g., 200)
    let response = Drive.Files.list({
      q: query,
      fields: 'files(id, name)',
      maxResults: 200
    });

    const projects = (response.files || []).map(file => ({
      id: file.id,
      title: file.name
    }));

    return { status: 'success', projects: projects };

  } catch (e) {
    console.error("Error listing Apps Script projects via Drive API:", e);
    let userMessage = `Apps Script project list error: ${e.message}`;

    if (e.name === 'ReferenceError' && e.message.includes("Drive is not defined")) {
      userMessage = `Failed to retrieve Apps Script projects. Drive API (Advanced Service) might not be enabled for this Apps Script project. Please enable 'Drive API' from 'Project settings' (gear icon) > 'Advanced Google Services' in the Apps Script editor and ensure it's linked to this project. Also, confirm that the appropriate OAuth scope (https://www.googleapis.com/auth/drive.readonly) is set in appsscript.json.`;
    } else if (e.message.includes("API call to drive.files.list failed with error")) {
      userMessage = `Failed to retrieve Apps Script projects. Please confirm that Drive API (Advanced Service) is enabled for this Apps Script project and that the appropriate OAuth scope (https://www.googleapis.com/auth/drive.readonly) is set in appsscript.json. Error: ${e.message}`;
    }
    return { status: 'error', message: userMessage };
  }
}

/**
 * Generates the editor URL for a given Apps Script ID.
 * @param {string} scriptId - The ID of the Apps Script.
 * @returns {string} - The Apps Script editor URL.
 */
function getScriptEditorUrl(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return "Error: Script ID is not specified.";
  }
  return `https://script.google.com/d/${scriptId}/edit`;
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
    const versionsApiBaseUrl = `https://script.googleapis.com/v1/projects/${scriptId}/versions`;
    const deploymentsApiUrl = `https://script.googleapis.com/v1/projects/${scriptId}/deployments`;

    // 1. Fetch all versions with pagination
    console.log(`Listing versions for Script ID ${scriptId} (fetching all pages)...`);
    let allVersionsFromApi = [];
    try {
      allVersionsFromApi = _listAllVersions(scriptId, accessToken);
    } catch (e) {
      return { status: 'error', message: `Version retrieval error: ${e.message}`, apiErrorDetails: e.apiErrorDetails || null, fullErrorText: e.fullErrorText || null };
    }
    
    let versions = allVersionsFromApi.map(v => ({
      versionNumber: v.versionNumber,
      createTime: v.createTime,
      description: v.description || 'No description',
      webappUrl: null // Initialize webappUrl
    }));

    // 2. Fetch all deployments to find web app URLs
    console.log(`Calling Deployments API URL: ${deploymentsApiUrl}`);
    let allDeployments = [];
    try {
      allDeployments = _listAllDeployments(scriptId, accessToken);
    } catch (e) {
      console.warn(`Deployment retrieval API error during version listing. Web app URLs will not be available: ${e.message}`);
      // Continue without web app URLs if deployment fetch fails
    }
    // Log a compact summary for raw deployments
    console.log(`  listScriptVersions: All raw deployments fetched (total: ${allDeployments.length}). Sample (first 5 compact):`, JSON.stringify(allDeployments.slice(0, 5).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));

    const webAppUrlMap = {}; // versionNumber -> webAppUrl map

    // Sort deployments by create time descending to get the latest web app URL for each version
    allDeployments.sort((a, b) => new Date(b.updateTime).getTime() - new Date(a.updateTime).getTime());
    // Log a compact summary for sorted deployments
    console.log(`  listScriptVersions: All deployments (sorted by updateTime descending, total: ${allDeployments.length}). Sample (first 5 compact):`, JSON.stringify(allDeployments.slice(0, 5).map(d => ({id: d.deploymentId, updateTime: d.updateTime, version: d.deploymentConfig?.versionNumber})), null, 2));

    allDeployments.forEach(d => {
      if (d.deploymentConfig && d.deploymentConfig.versionNumber) {
        console.log(`  listScriptVersions: Processing deployment ${d.deploymentId} (Version: ${d.deploymentConfig.versionNumber}, Updated: ${d.updateTime}) for web app URL mapping.`);
        d.entryPoints?.forEach(ep => {
          if (ep.entryPointType === 'WEB_APP' && ep.webApp && ep.webApp.url) {
            // Add only if not already mapped, ensuring latest deployment's URL
            if (!webAppUrlMap[d.deploymentConfig.versionNumber]) {
              webAppUrlMap[d.deploymentConfig.versionNumber] = ep.webApp.url;
              console.log(`  listScriptVersions: Mapped latest web app URL for version ${d.deploymentConfig.versionNumber}: ${ep.webApp.url} (from deployment ${d.deploymentId} updated at ${d.updateTime})`);
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

    // Sort versions by versionNumber descending (latest first)
    versions.sort((a, b) => b.versionNumber - a.versionNumber);
    // Log a compact summary for the final list of versions
    console.log(`  listScriptVersions: Final list of versions (sorted by versionNumber descending, total: ${versions.length}). Sample (first 5 compact):`, JSON.stringify(versions.slice(0, 5).map(v => ({versionNumber: v.versionNumber, createTime: v.createTime, webappUrl: v.webappUrl})), null, 2));

    return { status: 'success', versions: versions, message: 'Versions retrieved successfully.' };

  } catch (e) {
    console.error("Error during version retrieval:", e);
    return { status: 'error', message: `Version retrieval error: ${e.message}`, apiErrorDetails: e.apiErrorDetails || null, fullErrorText: e.fullErrorText || null };
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
    const getContentForVersionUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content?versionNumber=${versionNumber}`;
    const currentContentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    // 1. Retrieve content of the specified version
    console.log(`Retrieving content for version ${versionNumber}...`);
    const getVersionContentResponse = _makeApiCall(getContentForVersionUrl, 'get', accessToken, null, `Failed to retrieve content for version ${versionNumber}`);
    const versionContent = JSON.parse(getVersionContentResponse.getContentText());
    
    if (!versionContent.files || !Array.isArray(versionContent.files) || versionContent.files.length === 0) {
      console.error(`Content for version ${versionNumber} contains no file data or is malformed. Response:`, getVersionContentResponse.getContentText());
      return {
        status: 'error',
        message: `Version ${versionNumber} content is empty or malformed (no files data). This version cannot be reverted to. Please check the Apps Script project's version history in the editor for details.`,
        apiResponse: getVersionContentResponse.getContentText()
      };
    }

    // 2. Update current HEAD with the retrieved version content (PUT)
    console.log(`Updating current script with content from version ${versionNumber}...`);
    const putContentPayload = { files: versionContent.files };
    _makeApiCall(currentContentUrl, 'put', accessToken, JSON.stringify(putContentPayload), `Error reverting script to version ${versionNumber}`);

    return { status: 'success', message: `Script successfully reverted to version ${versionNumber}.` };

  } catch (e) {
    console.error("Error during version reversion:", e);
    return { status: 'error', message: `Version reversion error: ${e.message}`, apiErrorDetails: e.apiErrorDetails || null, fullErrorText: e.fullErrorText || null };
  }
}

/**
 * Retrieves a list of files (name and type) for the specified Apps Script project.
 * @param {string} scriptId - The ID of the Apps Script to retrieve files for.
 * @returns {object} - Object indicating status and file list (on success).
 */
function listTargetScriptFiles(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return { status: 'error', message: 'Script ID is not specified.' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    console.log(`Retrieving file content for Script ID: ${scriptId}...`);
    const response = _makeApiCall(contentUrl, 'get', accessToken, null, 'Failed to retrieve script content');
    
    const projectContent = JSON.parse(response.getContentText());
    
    const filesList = (projectContent.files || []).map(file => ({
      name: file.name,
      type: file.type
    }));

    return { status: 'success', files: filesList, message: `Successfully retrieved ${filesList.length} files.` };

  } catch (error) {
    console.error("Error retrieving file list:", error);
    return { status: 'error', message: `File list retrieval error: ${error.message}`, apiErrorDetails: error.apiErrorDetails || null, fullErrorText: error.fullErrorText || null };
  }
}