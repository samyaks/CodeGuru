# UpdateAI Export System - Quick Start Guide

## 5-Minute Setup

### Step 1: Capture Context (30 seconds)
1. Visit Jira, Slack, or Google Docs
2. Highlight relevant text
3. Context is automatically captured

### Step 2: Export (30 seconds)
1. Click extension icon
2. Click **"✨ Export to AI"**
3. View quality score
4. Select AI model
5. Click **"📋 Copy to Clipboard"**

### Step 3: Use in AI (1 minute)
1. Open Claude, ChatGPT, or Gemini
2. Paste the prompt
3. Get optimized code generation

---

## Export Formats Summary

| Model | Best For | Format | Special Features |
|-------|----------|--------|------------------|
| **Claude 3.5 Sonnet** | Complex reasoning, full implementations | XML | Thinking mode, Artifacts |
| **GPT-4** | Well-rounded, stable output | Markdown | Clean structure |
| **Gemini 1.5 Pro** | Long context, multimodal | Natural | Conversational |
| **Cursor AI** | In-IDE quick prompts | Concise | Directive style |

---

## Template Cheat Sheet

| Template | Use When | Key Sections |
|----------|----------|--------------|
| **Feature Implementation** | Building new features | Objective, Requirements, Tech Spec, UI/UX |
| **Bug Fix** | Debugging issues | Bug Description, Reproduction, Context |
| **API Integration** | Connecting APIs | API Details, Error Handling, Security |
| **Code Refactor** | Improving code | Current Code, Requirements, Constraints |
| **Architecture Design** | System design | System Overview, Requirements, Scale |

---

## Quality Score Guide

| Score | Label | What It Means | Action |
|-------|-------|---------------|--------|
| **9-10** | Excellent | Ready for AI | Export now! |
| **7-8** | Good | Minor improvements | Optional tweaks |
| **5-6** | Fair | Missing details | Add requirements |
| **3-4** | Poor | Critical issues | Fix before export |
| **1-2** | Needs Work | Incomplete | Add more content |

---

## Common Issues & Fixes

### "Export button disabled"
**Fix:** Capture some context or add project links first

### "Low quality score (< 5)"
**Fix:** 
- Add clear objective (20+ characters)
- List 3+ specific requirements
- Mention technical constraints
- Add edge cases

### "Vague requirements warning"
**Fix:** Replace vague terms with specifics
- ❌ "good performance"
- ✅ "response time < 200ms"

### "No edge cases warning"
**Fix:** Ask "What could go wrong?"
- Network failures?
- Invalid input?
- Missing data?

---

## Code Examples

### Basic Export
```javascript
import { ExportManager } from './export';

const result = await ExportManager.export({
  model: 'claude-3.5-sonnet'
});

await ExportManager.copyToClipboard(result.prompt);
```

### With Template
```javascript
const template = await TemplateManager.getTemplate('feature-implementation');

const result = await ExportManager.export({
  model: 'gpt-4',
  template: template
});
```

### Quality Check
```javascript
const analysis = await ExportManager.getQualityAnalysis();

if (analysis.score >= 7) {
  // Good to export!
} else {
  console.log('Fix these:', analysis.issues);
}
```

---

## Tips for 9+ Quality Score

1. ✅ **Clear Objective** - What you're building and why
2. ✅ **3+ Requirements** - Specific, measurable
3. ✅ **Tech Stack** - Frameworks, languages, tools
4. ✅ **Constraints** - Performance, compatibility, budget
5. ✅ **Edge Cases** - Errors, failures, invalid input
6. ✅ **Testing** - How to verify it works
7. ✅ **Context** - 3+ captures from sources

---

## Keyboard Shortcuts (Coming Soon)

- `Ctrl/Cmd + E` - Open export modal
- `Ctrl/Cmd + C` - Copy to clipboard
- `Ctrl/Cmd + D` - Download markdown
- `Escape` - Close modal

---

## Support

- 📖 Full docs: `src/export/README.md`
- 🎯 Summary: `EXPORT_SYSTEM_SUMMARY.md`
- 💻 Code: `src/export/`

---

**Happy exporting! 🚀**
