// ==UserScript==
// @name         pulls.review GitLab connector
// @namespace    https://github.com/lulu0119/pulls.review
// @version      1.0.0
// @description  Read configured GitLab instances from your browser, including private networks.
// @match        https://lulu0119.github.io/pulls.review/*
// @match        http://localhost:5173/*
// @match        http://127.0.0.1:5173/*
// @grant        GM_xmlhttpRequest
// @connect      *
// @run-at       document-end
// ==/UserScript==

/* global GM_xmlhttpRequest */

(() => {
  document.documentElement.setAttribute('data-pulls-review-gitlab-bridge', '1')
  window.addEventListener('pulls-review:gitlab-request', (event) => {
    const { id, url, headers } = JSON.parse(event.detail)
    const reply = data => window.dispatchEvent(new CustomEvent('pulls-review:gitlab-response', {
      detail: JSON.stringify({ id, ...data }),
    }))
    try {
      const target = new URL(url)
      const settings = JSON.parse(localStorage.getItem('diffs:settings') || '{}')
      const connection = (settings.gitlab || []).find(item =>
        item.transport === 'userscript' && target.href.startsWith(`${item.instance}/api/v4/`),
      )
      if (!connection || !['http:', 'https:'].includes(target.protocol) || target.username || target.password)
        throw new Error('This instance is not enabled for the connector. Save it in Settings → GitLab first.')
      // Only API reads are exposed. Never send browser session cookies or follow redirects.
      GM_xmlhttpRequest({
        method: 'GET',
        url,
        headers,
        anonymous: true,
        redirect: 'error',
        timeout: 60000,
        onload: response => reply({ status: response.status, body: response.responseText }),
        onerror: () => reply({ error: 'Cannot reach GitLab. Check VPN, certificate trust and extension permissions.' }),
        ontimeout: () => reply({ error: 'GitLab request timed out.' }),
      })
    }
    catch (error) {
      reply({ error: String(error) })
    }
  })
})()
