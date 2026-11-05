import type { Credentials } from './types/source'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGitlabClient, createGitlabMergeRequestSource, normalizeGitlabInstance, parseGitlabUrl } from './gitlab'
import { serializeRef } from './types/source'

const ref = { kind: 'gitlab-mr', instance: 'https://git.internal:8443/gitlab', project: 'team/sub/repo', number: '42' } as const
const mr = {
  title: 'Fix parser',
  description: 'Details',
  web_url: `${ref.instance}/${ref.project}/-/merge_requests/42`,
  state: 'opened',
  author: { username: 'lulu' },
  created_at: '2026-11-01',
  updated_at: '2026-11-02',
  source_branch: 'fix',
  target_branch: 'main',
  source_project_id: 2,
  target_project_id: 1,
  diff_refs: { base_sha: 'base', head_sha: 'head', start_sha: 'tip' },
}
const file = { old_path: 'old.ts', new_path: 'new.ts', renamed_file: true, new_file: false, deleted_file: false, diff: '@@ -1 +1 @@\n-old\n+new\n' }
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })
afterEach(() => vi.restoreAllMocks())

describe('gitLab URLs and identity', () => {
  it('reads subgroups and ignores UI query/fragment', () => {
    expect(parseGitlabUrl(`${mr.web_url}/diffs?view=parallel#abc`, [ref.instance])).toEqual(ref)
    expect(parseGitlabUrl('https://gitlab.com/a/b/-/merge_requests/9')).toEqual({ kind: 'gitlab-mr', instance: 'https://gitlab.com', project: 'a/b', number: '9' })
    expect(parseGitlabUrl('https://gitlab.com/a/b/-/issues/9')).toBeUndefined()
    expect(parseGitlabUrl('https://user:pass@gitlab.com/a/b/-/merge_requests/9')).toBeUndefined()
  })
  it('normalizes instances without allowing embedded credentials', () => {
    expect(normalizeGitlabInstance(`${ref.instance}/`)).toBe(ref.instance)
    expect(() => normalizeGitlabInstance('javascript:alert(1)')).toThrow()
    expect(() => normalizeGitlabInstance('https://token@gitlab.com')).toThrow()
    expect(serializeRef(ref)).not.toEqual(serializeRef({ ...ref, instance: 'https://another.internal' }))
  })
})

describe('gitLab source', () => {
  it('normalizes MR metadata, merge base, renamed patches and per-instance authentication', async () => {
    const transport = vi.fn(async (url: string, _init?: RequestInit) => json(url.includes('/diffs?') ? [file] : mr))
    const credentials: Credentials = { githubToken: async () => 'github-secret', gitlabToken: vi.fn(async () => 'gitlab-secret') }
    const source = createGitlabMergeRequestSource(ref, credentials, transport)
    const diff = await source.fetch()
    expect(diff.base?.sha).toBe('base')
    expect(diff.head?.sha).toBe('head')
    expect(diff.label).toBe('!42')
    expect(diff.files[0]).toMatchObject({ path: 'new.ts', previousPath: 'old.ts', status: 'renamed', additions: 1, deletions: 1, isBinary: false })
    expect(credentials.gitlabToken).toHaveBeenCalledWith(ref.instance)
    const init = transport.mock.calls[0]!
    expect(init[0]).toContain('/api/v4/projects/team%2Fsub%2Frepo/merge_requests/42')
    expect(init[1]).toMatchObject({ headers: { 'PRIVATE-TOKEN': 'gitlab-secret' }, credentials: 'omit', redirect: 'error' })
    expect(await source.fingerprint!()).toBe('head')
  })
  it('paginates without needing exposed pagination headers', async () => {
    const transport = vi.fn(async (url: string) => json(url.includes('&page=1') ? Array.from({ length: 100 }).fill(file) : [file]))
    expect(await createGitlabClient(ref.instance, undefined, transport).paginate('/diffs')).toHaveLength(101)
    expect(transport).toHaveBeenCalledTimes(2)
  })
  it('loads omitted patches from the merge base and fork source project', async () => {
    const transport = vi.fn(async (url: string) => {
      if (url.includes('/diffs?'))
        return json([{ ...file, diff: '', too_large: true }])
      if (url.includes('/raw?ref=base'))
        return new Response('old\n')
      if (url.includes('/raw?ref=head'))
        return new Response('new\n')
      return json(mr)
    })
    const diff = await createGitlabMergeRequestSource(ref, undefined, transport).fetch()
    expect(diff.files[0]).toMatchObject({ additions: 1, deletions: 1, isBinary: false })
    expect(transport.mock.calls.map(call => call[0])).toContain(`${ref.instance}/api/v4/projects/1/repository/files/old.ts/raw?ref=base`)
    expect(transport.mock.calls.map(call => call[0])).toContain(`${ref.instance}/api/v4/projects/2/repository/files/new.ts/raw?ref=head`)
  })
  it('does not render binary files as text', async () => {
    const transport = async (url: string) => url.includes('/raw?') ? new Response('\0binary') : json(url.includes('/diffs?') ? [{ ...file, diff: '' }] : mr)
    const diff = await createGitlabMergeRequestSource(ref, undefined, transport).fetch()
    expect(diff.files[0]).toMatchObject({ isBinary: true, hunks: [] })
  })
  it('supports older GitLab but refuses an incomplete file list', async () => {
    let overflow = false
    const transport = async (url: string) => {
      if (url.includes('/diffs?'))
        return json({}, 404)
      if (url.includes('/changes?'))
        return json({ changes: [file], overflow })
      return json(mr)
    }
    const source = createGitlabMergeRequestSource(ref, undefined, transport)
    expect((await source.fetch()).files).toHaveLength(1)
    overflow = true
    await expect(source.fetch()).rejects.toThrow('truncated')
  })
  it('reports unprepared diffs and authentication failures', async () => {
    await expect(createGitlabMergeRequestSource(ref, undefined, async () => json({ ...mr, diff_refs: null })).fetch()).rejects.toThrow('preparing')
    await expect(createGitlabMergeRequestSource(ref, undefined, async () => json({}, 401)).fetch()).rejects.toThrow('401')
  })
  it('reads a replaced token on the next request', async () => {
    let token = 'first'
    const transport = vi.fn(async (_url: string, _init?: RequestInit) => json([]))
    const client = createGitlabClient(ref.instance, { githubToken: async () => undefined, gitlabToken: async () => token }, transport)
    await client.request('/projects')
    token = 'second'
    await client.request('/projects')
    expect(transport.mock.calls[1]![1]?.headers).toEqual({ 'PRIVATE-TOKEN': 'second' })
  })
})
