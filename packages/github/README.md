# @codeguru/github

Shared GitHub REST API client for CodeGuru services.

## Usage

```js
const github = require('@codeguru/github');

const { owner, repo } = github.parseRepoUrl('https://github.com/owner/repo');
const tree = await github.fetchRepoTree(owner, repo);
```

Requires `GITHUB_TOKEN` env var for authenticated access (5000 req/hr vs 60 req/hr unauthenticated).
