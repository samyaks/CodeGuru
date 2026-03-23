# Extension Icons

Add the following icon files to this directory:

- `icon16.png` - 16x16px icon for toolbar
- `icon32.png` - 32x32px icon for toolbar @2x
- `icon48.png` - 48x48px icon for extension management
- `icon128.png` - 128x128px icon for Chrome Web Store

## Design Guidelines

- Use the UpdateAI brand colors
- Keep design simple and recognizable
- Ensure visibility on light and dark backgrounds
- Follow Chrome Web Store icon guidelines

## Temporary Workaround

If icons are missing, the extension will still work. The manifest references these files, so either:

1. Add actual PNG files with the correct dimensions
2. Or comment out the icon references in `manifest.json`

## Brand Colors

Primary: `#667eea` to `#764ba2` (gradient)
Accent: `#3b82f6`
Success: `#10b981`
Warning: `#f59e0b`
