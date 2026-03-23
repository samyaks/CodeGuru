// src/content/google-docs.js
console.log('[KnowledgeGraph] Content script loaded on Google Docs!');

function init() {
  console.log('[KnowledgeGraph] Initializing...');
  
  const titleElement = document.querySelector('.docs-title-input');
  
  if (titleElement) {
    const title = titleElement.value;
    const url = window.location.href;
    
    console.log('[KnowledgeGraph] Document detected:');
    console.log('  Title:', title);
    console.log('  URL:', url);
    
    // Send to background worker
    chrome.runtime.sendMessage({
      type: 'DOCUMENT_DETECTED',
      title: title,
      url: url
    });
    
    console.log('[KnowledgeGraph] Message sent to background worker');
    
  } else {
    console.log('[KnowledgeGraph] Title element not found yet, retrying...');
    setTimeout(init, 1000);
  }
}

setTimeout(init, 2000);