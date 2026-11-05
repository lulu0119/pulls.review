import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import connectorSource from '../public/gitlab-connector.user.js?raw'
import { gitlabTransport, userscriptGitlabFetch } from './gitlab-transport'

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('data-pulls-review-gitlab-bridge')
})

describe('gitLab browser transport', () => {
  it('only reads configured API roots, without cookies or redirects', () => {
    const bridgeWindow = new EventTarget()
    const xhr = vi.fn()
    runInNewContext(connectorSource, {
      document,
      window: bridgeWindow,
      localStorage: { getItem: () => JSON.stringify({ gitlab: [{ instance: 'http://git.internal', transport: 'userscript' }] }) },
      URL,
      CustomEvent,
      GM_xmlhttpRequest: xhr,
    })
    const send = (url: string) => bridgeWindow.dispatchEvent(new CustomEvent('pulls-review:gitlab-request', { detail: JSON.stringify({ id: 'one', url, headers: {} }) }))
    send('http://git.internal/api/v4/projects')
    expect(xhr).toHaveBeenCalledWith(expect.objectContaining({ method: 'GET', anonymous: true, redirect: 'error' }))
    send('http://git.internal.evil.test/api/v4/projects')
    send('http://git.internal/api/v4/../../admin')
    send('http://elsewhere/api/v4/projects')
    expect(xhr).toHaveBeenCalledTimes(1)
  })
  it('requires an explicitly saved self-managed instance before making a request', async () => {
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    await expect(gitlabTransport('http://intranet', () => [])('http://intranet/api/v4/user')).rejects.toThrow('Add this GitLab instance')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('gives installation instructions when the connector is absent', async () => {
    await expect(userscriptGitlabFetch('http://intranet/api/v4/user')).rejects.toThrow('Install the GitLab connector')
  })
  it('correlates connector responses and removes its listener after completion', async () => {
    document.documentElement.setAttribute('data-pulls-review-gitlab-bridge', '1')
    const handler = (event: Event) => {
      const request = JSON.parse((event as CustomEvent<string>).detail)
      window.dispatchEvent(new CustomEvent('pulls-review:gitlab-response', { detail: JSON.stringify({ id: 'unrelated', error: 'ignored' }) }))
      window.dispatchEvent(new CustomEvent('pulls-review:gitlab-response', { detail: JSON.stringify({ id: request.id, status: 200, body: '{"username":"lulu"}' }) }))
    }
    window.addEventListener('pulls-review:gitlab-request', handler)
    try {
      const response = await userscriptGitlabFetch('http://intranet/api/v4/user')
      expect(await response.json()).toEqual({ username: 'lulu' })
    }
    finally {
      window.removeEventListener('pulls-review:gitlab-request', handler)
    }
  })
})
