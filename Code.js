function doGet() {
  return HtmlService.createTemplateFromFile('index').evaluate().setTitle('Methane AI Agent');
}

/**
 * Includes a HTML file by name.
 * @param {string} filename - The name of the HTML file (without extension).
 * @returns {string} The content of the HTML file.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}
