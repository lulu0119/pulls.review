<picture>
  <source media="(prefers-color-scheme: dark)" srcset="./packages/app/public/og-dark.png">
  <source media="(prefers-color-scheme: light)" srcset="./packages/app/public/og.png">
  <img alt="pulls.review Open Graph image" src="./packages/app/public/og.png">
</picture>

# [pulls.review](https://pulls.review)

> [!WARNING]
> Heavily work in progress.

Pull request review made simple. Groups changed files, summarizes what matters, and reviews them one scope at a time.

## GitLab support in this fork

Hosted at **https://lulu0119.github.io/pulls.review/**. Paste a GitLab merge request
URL into the home page, including subgroup paths such as
`https://gitlab.company.test/team/subgroup/repo/-/merge_requests/42`.

1. Open **Configure GitLab** and save the instance root URL (include a relative URL
   root if your installation uses one; exclude dashboard and project paths).
2. For private projects, enter a personal or project access token with `read_api`.
   Each instance has its own token, stored only in this browser.
3. For intranet, HTTP, or instances without CORS, install Tampermonkey or
   Violentmonkey, install the **GitLab connector** linked in Settings, and reload
   the page. Leave the connection method on **Browser connector**. Allow the
   extension to connect to your instance when prompted, and connect your VPN if
   needed. No reverse proxy or public exposure of GitLab is required.
4. Use **Test connection**, then open your MR URL from the home page.

Direct access is also available for HTTPS instances allowing the site's origin
through CORS. The connector only reads `/api/v4/` on instances explicitly saved
for connector access, omits session cookies, and refuses redirects. GitHub Pages
hosts static files; GitLab API calls originate from the user's computer. Model
analysis is optional and sends code to the selected model provider when run.

Supported: MR metadata and diffs, nested groups, renames/additions/deletions,
binary files, pagination, full-file loading (including cross-project MRs), cached
reviews, refresh, grouping and AI analysis/chat. Older GitLab versions use the
`/changes` endpoint. GitLab comments, approvals and publishing shared analyses
are not implemented; use the original MR page for those actions.

MR commits are loaded oldest first and included in the AI context. The commit
picker opens each commit against its first parent; **All changes** returns to
the whole MR. Older cached MRs automatically refresh their commit metadata while
preserving their AI results. Group explanations appear in the left sidebar;
new AI analyses require an explanation for every group and subgroup. Re-run AI
analysis to regenerate older results that omitted explanations or commit context.

The Pages workflow builds on pushes to `main` and uses hash routes so deep links
and refresh work without a server rewrite. Other deployment targets retain
history routing.

## Use on Website

To use pulls.review on the website, simply visit [pulls.review](https://pulls.review) and follow the instructions to connect your GitHub account and start reviewing pull requests directly in your browser.

## Use in GitHub

You can optionally install userscript to enhance the GitHub interface with pulls.review features.

Go to [pulls.review](https://pulls.review/) and scroll down to the GitHub section to install the userscript.

## Analyze pull requests from CI (Experimental)

Instead of each reviewer spending their own model key, let a workflow analyze every pull request once and post the result as a PR comment. pulls.review picks the comment up automatically for everyone who opens the PR there. Re-runs on an unchanged PR skip the model call.

```yaml
# .github/workflows/pulls-review.yml
name: pulls.review
on:
  # The analysis only reads the diff through the API and never checks out PR code,
  # so `pull_request_target` is safe here and lets fork PRs get a comment too.
  pull_request_target:
    types: [opened, synchronize, reopened]

permissions:
  pull-requests: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: antfu/pulls.review@main
        with:
          api-key: ${{ secrets.VERCEL_AI_GATEWAY_API_KEY }}
```

`provider` is inferred from the key you pass (`gateway` for a Vercel AI Gateway token, `anthropic`, or `openai-compatible` with `base-url`); set it explicitly, along with `model` and `locale`, when you want to.

The action is a thin wrapper around the `@pulls.review/actions` CLI, which works anywhere a GitHub token and a model key are in the environment:

```sh
GITHUB_TOKEN=... ANTHROPIC_API_KEY=... npx @pulls.review/actions owner/repo#123
```

Every variable also has a `PULLS_REVIEW_*` form that takes precedence (`PULLS_REVIEW_GITHUB_TOKEN`, `PULLS_REVIEW_PROVIDER`, `PULLS_REVIEW_API_KEY`, `PULLS_REVIEW_MODEL`, `PULLS_REVIEW_BASE_URL`, `PULLS_REVIEW_LOCALE`); `npx @pulls.review/actions --help` lists everything.

## Packages

| Package                                       | What it is                                                                                      |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [`packages/app`](./packages/app)              | The site at [pulls.review](https://pulls.review) and the github.com embed.                      |
| [`@pulls.review/core`](./packages/core)       | Fetching, parsing, grouping and summarizing diffs - runs in the browser and in Node.            |
| [`@pulls.review/actions`](./packages/actions) | The CLI the GitHub Action runs.                                                                 |
| [`pulls.review`](./packages/cli)              | The standalone CLI for reviewing local git changes. Not implemented yet - the name is reserved. |

## Credits

Inspired heavily by [Linear's PR review guides](https://linear.app/docs/diffs#guides), thanks for the inspiration.

## Sponsors

<p align="center">
  <a href="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg">
    <img src="https://cdn.jsdelivr.net/gh/antfu/static/sponsors.svg" alt="Sponsors"/>
  </a>
</p>

## License

MIT License
