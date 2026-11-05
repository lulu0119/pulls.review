import type { GroupedResult } from '@pulls.review/core/types'
import { createCacheRepositories } from '@pulls.review/core/cache'
import { createGitlabMergeRequestSource } from '@pulls.review/core/gitlab'
import { mount } from '@vue/test-utils'
import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { appContextKey } from '../app-context'
import { settings } from '../state/settings'
import GitlabPage from './gitlab.vue'

const DiffsPageStub = defineComponent({
  props: ['store', 'commitNav'],
  template: '<h1>{{ store.diff?.title }}</h1>',
})

afterEach(() => vi.unstubAllGlobals())

describe('gitLab page commit navigation', () => {
  it('upgrades old cached MRs, preserves paid analyses, and navigates individual commits and back', async () => {
    const ref = { kind: 'gitlab-mr', instance: 'https://git.internal', project: 'team/repo', number: '1' } as const
    const previousSettings = settings.value
    settings.value = { ...settings.value, gitlab: [{ instance: ref.instance, token: '', transport: 'direct' }] }
    const mr = {
      title: 'Whole MR',
      description: '',
      web_url: `${ref.instance}/team/repo/-/merge_requests/1`,
      state: 'opened',
      author: { username: 'Alice' },
      created_at: '2026-11-01',
      updated_at: '2026-11-02',
      source_branch: 'feature',
      target_branch: 'main',
      source_project_id: 2,
      target_project_id: 1,
      diff_refs: { base_sha: 'base', head_sha: 'bbb', start_sha: 'tip' },
    }
    const commits = [
      { id: 'bbb', message: 'Second commit', author_name: 'Alice', created_at: '2026-11-02', parent_ids: ['aaa'], web_url: 'https://git.internal/commit/bbb' },
      { id: 'aaa', message: 'First commit', author_name: 'Alice', created_at: '2026-11-01', parent_ids: ['base'], web_url: 'https://git.internal/commit/aaa' },
    ]
    const patch = [{ old_path: 'a.ts', new_path: 'a.ts', new_file: false, renamed_file: false, deleted_file: false, diff: '@@ -1 +1 @@\n-old\n+new' }]
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const result = url.includes('/commits?') ? commits : url.includes('/diffs?') || url.includes('/diff?') ? patch : url.endsWith('/repository/commits/aaa') ? commits[1] : mr
      return new Response(JSON.stringify(result))
    }))
    const cache = createCacheRepositories(createStorage({ driver: memoryDriver() }))
    const credentials = { githubToken: async () => undefined }
    const key = await createGitlabMergeRequestSource(ref).key()
    const analysis: GroupedResult = { source: 'llm', schemaVersion: 1, generatedAt: '2026-11-01', groups: [{ key: 'core', label: 'Core', summary: 'Preserved explanation.', category: 'core', filePaths: ['a.ts'] }] }
    await cache.diffs.putDiff(key, { ref, title: 'Old cached MR', head: { sha: 'bbb', ref: 'feature' }, files: [] }, 'bbb')
    await cache.diffs.setAnalyzedResult(key, 'llm', analysis)
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/review', component: GitlabPage, props: { sourceRef: ref } }] })
    await router.push('/review')
    const wrapper = mount(RouterView, {
      global: { plugins: [router], provide: { [appContextKey as symbol]: { cache, credentials } }, stubs: { DiffsPage: DiffsPageStub } },
    })
    try {
      await vi.waitFor(() => expect(wrapper.findComponent(DiffsPageStub).props('commitNav')?.commits.map((commit: { sha: string }) => commit.sha)).toEqual(['aaa', 'bbb']))
      expect(wrapper.findComponent(DiffsPageStub).props('store').aiResult).toEqual(analysis)
      wrapper.findComponent(DiffsPageStub).props('commitNav').select('aaa')
      await vi.waitFor(() => expect(wrapper.get('h1').text()).toBe('First commit'))
      expect(router.currentRoute.value.query.commit).toBe('aaa')
      expect(wrapper.findComponent(DiffsPageStub).props('store').diff.ref.kind).toBe('gitlab-commit')
      wrapper.findComponent(DiffsPageStub).props('commitNav').select()
      await vi.waitFor(() => expect(wrapper.get('h1').text()).toBe('Whole MR'))
      expect(wrapper.findComponent(DiffsPageStub).props('store').aiResult).toEqual(analysis)
    }
    finally {
      wrapper.unmount()
      settings.value = previousSettings
    }
  })
})
