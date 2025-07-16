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

  const effectiveVersion = libraryVersion.trim() === '' ? 'HEAD' : libraryVersion.trim();

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${targetScriptId}/content`;

    // 1. Get current appsscript.json content
    console.log(`Retrieving current content for Script ID ${targetScriptId} to modify appsscript.json...`);
    const getResponse = _makeApiCall(contentUrl, 'get', accessToken, null, 'Failed to retrieve script content for appsscript.json modification');
    const projectContent = JSON.parse(getResponse.getContentText());

    let appsscriptJsonFile = projectContent.files.find(file => file.name === 'appsscript' && file.type === 'JSON');

    if (!appsscriptJsonFile) {
      return { status: 'error', message: 'appsscript.json file not found in the target script.' };
    }

    let manifest;
    try {
      manifest = JSON.parse(appsscriptJsonFile.source);
    } catch (e) {
      console.error(`Failed to parse appsscript.json content: ${e.message}. Content: ${appsscriptJsonFile.source}`);
      return { status: 'error', message: `Failed to parse appsscript.json: ${e.message}` };
    }

    // Ensure dependencies and dependencies.libraries exist
    if (!manifest.dependencies) {
      manifest.dependencies = {};
    }
    if (!manifest.dependencies.libraries) {
      manifest.dependencies.libraries = [];
    }

    // Check for existing library to prevent duplicates or update version
    const existingLibraryIndex = manifest.dependencies.libraries.findIndex(
      lib => lib.libraryId === libraryScriptId
    );

    if (existingLibraryIndex !== -1) {
      const existingLib = manifest.dependencies.libraries[existingLibraryIndex];
      if (existingLib.version !== effectiveVersion) {
        existingLib.version = effectiveVersion;
        appsscriptJsonFile.source = JSON.stringify(manifest, null, 2); // Prettify output
        console.log(`Updated version of existing library '${libraryScriptId}' to '${effectiveVersion}'.`);
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
      console.log(`Adding new library '${libraryScriptId}' (Version: ${effectiveVersion}).`);
    }

    // Prepare files array for updateContent - only include appsscript.json for modification
    const filesToUpdate = projectContent.files.map(file => {
      if (file.name === 'appsscript' && file.type === 'JSON') {
        return appsscriptJsonFile; // Return the modified appsscript.json
      }
      return file; // Return other files as is
    });
    
    const updatePayload = { files: filesToUpdate };

    // 2. Update the project content (appsscript.json)
    console.log(`Updating appsscript.json for Script ID ${targetScriptId}...`);
    _makeApiCall(contentUrl, 'put', accessToken, JSON.stringify(updatePayload), 'Failed to update appsscript.json');

    return { status: 'success', message: `Library '${libraryScriptId}' (Version: ${effectiveVersion}) has been added to (or updated in) the target script.` };

  } catch (error) {
    console.error("Error during library addition:", error);
    return { status: 'error', message: `Library addition error: ${error.message}`, apiErrorDetails: error.apiErrorDetails || null, fullErrorText: error.fullErrorText || null };
  }
}

/**
 * Retrieves the OAuth scopes for the specified Apps Script project.
 * @param {string} scriptId - The ID of the Apps Script to retrieve OAuth scopes for.
 * @returns {object} - Object indicating status and array of OAuth scopes (on success).
 */
function getProjectOAuthScopes(scriptId) {
  if (!scriptId || scriptId.trim() === '') {
    return { status: 'error', message: 'Script ID is not specified.' };
  }

  try {
    const accessToken = ScriptApp.getOAuthToken();
    const contentUrl = `https://script.googleapis.com/v1/projects/${scriptId}/content`;

    console.log(`Retrieving appsscript.json for Script ID: ${scriptId}...`);
    const getResponse = _makeApiCall(contentUrl, 'get', accessToken, null, 'Failed to retrieve script content for OAuth scopes');
    
    let projectContent;
    try {
      projectContent = JSON.parse(getResponse.getContentText());
    } catch (e) {
      console.error(`Failed to parse Apps Script API response: ${e.message}. Body: ${getResponse.getContentText()}`);
      return { status: 'error', message: `Failed to parse API response for script content.`, apiErrorDetails: { parseError: e.message, responseSnippet: getResponse.getContentText().substring(0, 500) } };
    }
    
    const appsscriptJsonFile = projectContent.files.find(file => file.name === 'appsscript' && file.type === 'JSON');

    if (!appsscriptJsonFile) {
      return { status: 'error', message: 'appsscript.json not found in the target script content. Please ensure the project has a valid appsscript.json file.' };
    }

    let manifest;
    try {
      manifest = JSON.parse(appsscriptJsonFile.source);
    } catch (e) {
      console.error(`Failed to parse appsscript.json content: ${e.message}. File content: ${appsscriptJsonFile.source}`);
      return { status: 'error', message: `Failed to parse appsscript.json. Its content might be malformed JSON. Error: ${e.message}`, apiErrorDetails: { fileName: appsscriptJsonFile.name, fileType: appsscriptJsonFile.type, parseError: e.message, fileContentSnippet: appsscriptJsonFile.source.substring(0, 500) } };
    }
    
    const oauthScopes = manifest.oauthScopes || [];

    return { status: 'success', scopes: oauthScopes, message: `Successfully retrieved ${oauthScopes.length} OAuth scopes.` };

  } catch (error) {
    console.error("An unexpected error occurred during OAuth scope retrieval:", error);
    return { status: 'error', message: `An unexpected error occurred during OAuth scope retrieval: ${error.message}`, apiErrorDetails: error.apiErrorDetails || null, fullErrorText: error.fullErrorText || null };
  }
}