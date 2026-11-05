import type { GitlabFetch } from '@pulls.review/core/gitlab'
import type { GitlabConnection } from './state/settings'

/** The optional userscript performs API reads through the browser extension. */
export const userscriptGitlabFetch: GitlabFetch = (url, init) => new Promise((resolve, reject) => {
  if (!document.documentElement.hasAttribute('data-pulls-review-gitlab-bridge')) {
    reject(new Error('Install the GitLab connector from Settings → GitLab, then reload this page.'))
    return
  }
  const id = crypto.randomUUID()
  let timer: ReturnType<typeof setTimeout>
  function cleanup() {
    clearTimeout(timer)
    window.removeEventListener('pulls-review:gitlab-response', receive)
  }
  function receive(event: Event) {
    const data = JSON.parse((event as CustomEvent<string>).detail)
    if (data.id !== id)
      return
    cleanup()
    if (data.error)
      reject(new Error(data.error))
    else
      resolve(new Response(data.body, { status: data.status, headers: { 'Content-Type': data.contentType ?? 'text/plain' } }))
  }
  timer = setTimeout(() => {
    cleanup()
    reject(new Error('GitLab connector timed out. Check VPN, network access and extension permissions for this instance.'))
  }, 65000)
  window.addEventListener('pulls-review:gitlab-response', receive)
  window.dispatchEvent(new CustomEvent('pulls-review:gitlab-request', {
    detail: JSON.stringify({ id, url, headers: Object.fromEntries(new Headers(init?.headers)) }),
  }))
})

export function gitlabTransport(instance: string, connections: () => GitlabConnection[]): GitlabFetch {
  return async (url, init) => {
    const connection = connections().find(item => item.instance === instance)
    if (!connection && instance !== 'https://gitlab.com')
      throw new Error('Add this GitLab instance in Settings → GitLab before connecting.')
    if (connection?.transport === 'userscript')
      return userscriptGitlabFetch(url, init)
    try {
      return await fetch(url, init)
    }
    catch {
      throw new Error('Unable to reach GitLab directly. Check VPN/HTTPS and CORS, or select the browser connector in Settings → GitLab.')
    }
  }
}
