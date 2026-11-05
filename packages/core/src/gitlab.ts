import type { DiffsPayload, FileChange } from './types/diff'
import type { Credentials, DiffSource, SourceRef } from './types/source'
import { createTwoFilesPatch } from 'diff'
import { computeContentHash, countChanges, parseHunks } from './patch-parser'
import { serializeRef } from './types/source'

export type GitlabRef = Extract<SourceRef, { kind: 'gitlab-mr' }>
export type GitlabFetch = (url: string, init?: RequestInit) => Promise<Response>

/** The instance can include a relative URL root, e.g. https://company.test/gitlab. */
export function normalizeGitlabInstance(value: string): string {
  const url = new URL(value.trim())
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Enter an HTTP(S) GitLab instance URL without credentials, query or fragment.')
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`
}

/** Subgroups, custom ports and self-managed installations under a relative URL root. */
export function parseGitlabUrl(text: string, instances: string[] = []): GitlabRef | undefined {
  try {
    const url = new URL(text.trim())
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
      return undefined
    const match = /^(.*?)\/-\/merge_requests\/(\d+)(?:\/.*)?$/.exec(url.pathname)
    if (!match)
      return undefined
    const configured = instances.map(normalizeGitlabInstance).sort((a, b) => b.length - a.length).find(instance => `${url.origin}${match[1]}`.startsWith(`${instance}/`))
    const instance = configured ?? url.origin
    const project = decodeURIComponent(match[1]!.slice(new URL(instance).pathname.replace(/\/$/, '').length).replace(/^\//, ''))
    if (project.split('/').length < 2 || project.split('/').some(part => !part || part === '.' || part === '..'))
      return undefined
    return { kind: 'gitlab-mr', instance, project, number: match[2]! }
  }
  catch {
    return undefined
  }
}

export class GitlabApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'GitlabApiError'
  }
}

export function createGitlabClient(instance: string, credentials?: Credentials, transport: GitlabFetch = fetch) {
  const base = `${normalizeGitlabInstance(instance)}/api/v4`
  async function request(path: string): Promise<Response> {
    const token = await credentials?.gitlabToken?.(normalizeGitlabInstance(instance))
    const headers: Record<string, string> = {}
    if (token)
      headers['PRIVATE-TOKEN'] = token
    const response = await transport(`${base}${path}`, { headers, credentials: 'omit', redirect: 'error' })
    if (!response.ok)
      throw new GitlabApiError(response.status, `GitLab API ${response.status}: ${path.split('?')[0]}. Check the instance URL, token and project access in Settings → GitLab.`)
    return response
  }
  async function json<T>(path: string): Promise<T> {
    return (await request(path)).json()
  }
  async function paginate<T>(path: string): Promise<T[]> {
    const result: T[] = []
    for (let page = 1; ; page++) {
      const response = await request(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`)
      const items: T[] = await response.json()
      result.push(...items)
      // Do not rely on pagination headers being exposed through CORS.
      if (items.length < 100)
        return result
    }
  }
  return { request, json, paginate }
}

interface MergeRequest {
  title: string
  description: string | null
  web_url: string
  state: string
  draft?: boolean
  work_in_progress?: boolean
  author: { username: string }
  created_at: string
  updated_at: string
  source_branch: string
  target_branch: string
  source_project_id: number | null
  target_project_id: number
  diff_refs: { base_sha: string, head_sha: string, start_sha: string } | null
  changes_count?: string
}

interface GitlabDiff {
  old_path: string
  new_path: string
  new_file: boolean
  deleted_file: boolean
  renamed_file: boolean
  diff: string
  collapsed?: boolean
  too_large?: boolean
}

export function createGitlabMergeRequestSource(ref: GitlabRef, credentials?: Credentials, transport?: GitlabFetch): DiffSource {
  const instance = normalizeGitlabInstance(ref.instance)
  const client = createGitlabClient(instance, credentials, transport)
  const projectPath = `/projects/${encodeURIComponent(ref.project)}`
  const mrPath = `${projectPath}/merge_requests/${ref.number}`
  let current: MergeRequest | undefined
  const mergeRequest = async () => current ??= await client.json<MergeRequest>(mrPath)

  async function loadFile(path: string, sha: string): Promise<string | undefined> {
    const mr = await mergeRequest()
    const project = sha === mr.diff_refs?.head_sha ? mr.source_project_id : mr.target_project_id
    if (project === null)
      throw new Error('The source project was deleted; full file contents are unavailable.')
    try {
      return await (await client.request(`/projects/${project}/repository/files/${encodeURIComponent(path)}/raw?ref=${encodeURIComponent(sha)}`)).text()
    }
    catch (error) {
      if (error instanceof GitlabApiError && error.status === 404)
        return undefined
      throw error
    }
  }

  async function readPatch(file: GitlabDiff, mr: MergeRequest): Promise<{ patch: string, isBinary: boolean }> {
    let patch = file.diff
    let isBinary = /^Binary files .* differ$/m.test(patch)
    // GitLab may omit a patch due to diff limits. Recover it from immutable file versions.
    if (!patch || file.collapsed || file.too_large) {
      const [oldText, newText] = await Promise.all([
        file.new_file ? undefined : loadFile(file.old_path, mr.diff_refs!.base_sha),
        file.deleted_file ? undefined : loadFile(file.new_path, mr.diff_refs!.head_sha),
      ])
      isBinary = !!oldText?.includes('\0') || !!newText?.includes('\0')
      if (!isBinary) {
        if ((!file.new_file && oldText === undefined) || (!file.deleted_file && newText === undefined))
          throw new Error(`GitLab omitted the patch and file contents for ${file.new_path}. Check project access or retry once the MR diff is ready.`)
        patch = createTwoFilesPatch(file.old_path, file.new_path, oldText ?? '', newText ?? '')
      }
    }
    return { patch, isBinary }
  }

  async function normalizeFile(file: GitlabDiff, mr: MergeRequest): Promise<FileChange> {
    const { patch, isBinary } = await readPatch(file, mr)
    const hunks = isBinary ? [] : parseHunks(patch.split('\n'))
    return {
      path: file.new_path,
      previousPath: file.renamed_file ? file.old_path : undefined,
      status: file.new_file ? 'added' : file.deleted_file ? 'removed' : file.renamed_file ? 'renamed' : 'modified',
      ...countChanges(hunks),
      isBinary,
      sha: await computeContentHash(`${file.old_path}\n${file.new_path}\n${patch}${isBinary ? mr.diff_refs!.head_sha : ''}`),
      hunks,
    }
  }

  return {
    key: async () => serializeRef({ ...ref, instance }),
    async fetch(): Promise<DiffsPayload> {
      current = await client.json<MergeRequest>(mrPath)
      const mr = current
      if (!mr.diff_refs?.base_sha || !mr.diff_refs.head_sha)
        throw new Error('GitLab is still preparing this merge request diff. Please retry shortly.')
      let diffs: GitlabDiff[]
      try {
        diffs = await client.paginate<GitlabDiff>(`${mrPath}/diffs`)
      }
      catch (error) {
        // GitLab before 15.7 provides /changes instead of the paginated /diffs endpoint.
        if (!(error instanceof GitlabApiError) || error.status !== 404)
          throw error
        const changes = await client.json<{ changes: GitlabDiff[], overflow?: boolean }>(`${mrPath}/changes?access_raw_diffs=true`)
        if (changes.overflow)
          throw new Error('This GitLab instance truncated the MR file list. Download its raw diff and use Upload a diff to review all files.')
        diffs = changes.changes
      }
      const expected = Number.parseInt(mr.changes_count ?? '', 10)
      if (Number.isFinite(expected) && (diffs.length < expected || (mr.changes_count?.endsWith('+') && diffs.length <= expected)))
        throw new Error('GitLab truncated this MR file list. Download its raw diff and use Upload a diff to review all files.')
      return {
        ref: { ...ref, instance },
        title: mr.title,
        label: `!${ref.number}`,
        author: { name: mr.author.username },
        description: mr.description ?? '',
        url: mr.web_url,
        base: { sha: mr.diff_refs.base_sha, ref: mr.target_branch },
        head: { sha: mr.diff_refs.head_sha, ref: mr.source_branch },
        createdAt: mr.created_at,
        updatedAt: mr.updated_at,
        pullRequest: { state: mr.state === 'merged' ? 'merged' : mr.state === 'closed' ? 'closed' : mr.draft || mr.work_in_progress ? 'draft' : 'open' },
        files: await Promise.all(diffs.map(file => normalizeFile(file, mr))),
      }
    },
    fingerprint: async () => (await client.json<MergeRequest>(mrPath)).diff_refs?.head_sha ?? '',
    loadFile,
    auth: 'gitlab-token',
  }
}
