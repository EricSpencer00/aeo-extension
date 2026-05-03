# Chrome Web Store Submission Checklist

Use this checklist when submitting the extension to the Chrome Web Store.

## Before Submission

- [ ] Version number updated in `manifest.json`
- [ ] All files in the extension are functional and tested
- [ ] No console errors or warnings in DevTools
- [ ] README.md is complete and accurate
- [ ] LICENSE file is present
- [ ] Icons are present (16x16, 48x48, 128x128)

## Required Assets

### 1. Extension Icon
- [x] 128x128 PNG icon (all-pixel colors required)
- File: `images/icon-128.png`

### 2. Screenshots (Chrome Web Store)
Recommended: 1280x800 PNG images showing:
- [ ] Popup with captured queries
- [ ] Settings page
- [ ] Query filtering in action
- [ ] Export to CSV feature

### 3. Promotional Images (Optional but recommended)
- [ ] Large tile (440x280) - Used on store
- [ ] Small tile (Small tile (320x240) - Used on store
- [ ] Marquee (1400x560) - Featured listing

### 4. Store Listing Content

#### Short Description (50 characters max)
```
See what AI is actually searching for
```

#### Full Description (required)
```
AEO Queries helps you see what search queries ChatGPT, Claude, Perplexity, and other popular AI interfaces are making. Perfect for SEO optimization and understanding AI search patterns.

🔍 FEATURES:
• Real-time query capture from major AI services
• View queries from ChatGPT, Claude, Perplexity, Google Gemini, Microsoft Copilot
• Filter queries by source
• Export to CSV for analysis
• 100% local data storage - nothing sent to servers
• Copy queries with one click

📊 USE CASES:
• SEO keyword research
• AI Engine Optimization (AEO) strategy
• Understanding AI search patterns
• Market trend analysis
• Content gap identification

🔒 PRIVACY:
All captured data is stored locally on your device. No data is sent to any external servers. Clear your queries anytime with one click.

💡 HOW IT WORKS:
1. Open your favorite AI chat interface
2. Ask a question that requires a web search
3. Click the AEO Queries extension to see what searches the AI made
4. Use these insights for your content strategy

⚠️ DISCLAIMER:
This extension is for research and optimization purposes. Always respect robots.txt and website terms of service.

For source code and to report issues: https://github.com/EricSpencer00/aeo-extension
```

#### Category
- Select: "Productivity"

#### Language
- Select: "English"

#### Websites
- Homepage: https://github.com/EricSpencer00/aeo-extension
- Support: https://github.com/EricSpencer00/aeo-extension/issues

#### Privacy Policy
```
AEO Queries Privacy Policy

1. Data Collection
We collect only the search queries made by AI services when you use the extension. No personal information is collected.

2. Data Storage
All data is stored locally on your device using Chrome's storage API. No data is transmitted to external servers.

3. Data Sharing
Your data is not shared with anyone. You have full control and can delete it anytime.

4. Permissions
- webRequest: To intercept and analyze network requests
- storage: To save captured queries locally
- tabs: To identify which tab made requests
- scripting: To inject detection scripts on AI pages

5. Changes
We may update this policy. Changes will be posted on our GitHub repository.

For questions: Open an issue on GitHub
https://github.com/EricSpencer00/aeo-extension/issues
```

## Metadata

| Field | Value |
|-------|-------|
| **Name** | AEO Queries - See What AI Is Searching |
| **Version** | 1.0.0 |
| **Category** | Productivity |
| **Supports Chrome** | Yes |
| **Supports Edge** | Yes (after approval) |

## File Preparation

```bash
# Create ZIP file for submission
cd ~/aeo-extension
npm run pack
# This creates: aeo-extension.zip (ready for upload)
```

## Submission Process

1. Go to [Chrome Web Store Developer Dashboard](https://chromewebstore.google.com/publish)
2. Click "Create new item"
3. Upload the ZIP file containing all extension files
4. Fill in all the details above
5. Upload screenshots and promotional images
6. Review and submit

## Review Timeline

- **Initial Review**: 1-3 hours
- **Full Review**: 1-7 days
- **Possible Actions**: 
  - Approved ✅
  - More information requested
  - Rejected (provide feedback on why)

## After Approval

- [ ] Extension appears on Chrome Web Store
- [ ] Update GitHub README with Web Store link
- [ ] Announce on social media
- [ ] Monitor reviews and ratings
- [ ] Respond to user feedback

## Common Rejection Reasons (Avoid These!)

❌ Misleading functionality
❌ Malware or security issues
❌ Excessive permissions without justification
❌ Privacy violations
❌ Impersonating other services
❌ Spam or repetitive content
❌ Poor user experience
❌ Violations of policies

## Policies to Review

- [Chrome Web Store Policies](https://developer.chrome.com/docs/webstore/program_policies/)
- [Content Policies](https://support.google.com/chrome_webstore/answer/1047779)
- [User Data Policy](https://developer.chrome.com/docs/webstore/user_data_policy/)

---

Good luck with your submission! 🚀

Questions? Check GitHub issues or open a new one.
