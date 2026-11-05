<script setup lang="ts">
import type { GitlabRef } from '@pulls.review/core/gitlab'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FeedbackLoading from '@antfu/design/components/Feedback/FeedbackLoading.vue'
import { createGitlabCommitSource, createGitlabMergeRequestSource } from '@pulls.review/core/gitlab'
import { onMounted } from 'vue'
import { useAppContext } from '../app-context'
import DiffsPage from '../components/diff/DiffsPage.vue'
import { useCommitView } from '../composables/useCommitView'
import { useDocumentTitle } from '../composables/useDocumentTitle'
import { gitlabTransport } from '../gitlab-transport'
import { settings } from '../state/settings'
import { openSettings } from '../state/settingsModal'
import { createDiffsStore } from '../stores/diffs-store'

const props = defineProps<{ sourceRef: GitlabRef }>()
const { cache, credentials, llm } = useAppContext()
const source = createGitlabMergeRequestSource(props.sourceRef, credentials, gitlabTransport(props.sourceRef.instance, () => settings.value.gitlab))
const parent = createDiffsStore(source, { cache, llm })
const { store, commitNav, selected } = useCommitView(parent, sha => createGitlabCommitSource(
  { ...props.sourceRef, sha },
  credentials,
  gitlabTransport(props.sourceRef.instance, () => settings.value.gitlab),
), { cache, llm })
useDocumentTitle(() => store.value.diff?.title ?? `${props.sourceRef.project}!${props.sourceRef.number}`)
onMounted(async () => {
  await parent.load()
  // Upgrade MR snapshots saved before commits were fetched, keeping their paid AI analysis.
  if (parent.diff && !parent.diff.commits)
    await parent.refresh()
})
</script>

<template>
  <main>
    <DiffsPage :key="selected ?? ''" :store="store" :commit-nav="commitNav">
      <template #loading>
        <FeedbackLoading :text="$t('pr.loading')" />
      </template>
      <template #error="{ error, retry }">
        <div class="flex flex-col gap-4">
          <p>{{ error.message }}</p>
          <div class="flex gap-2">
            <ActionButton @click="openSettings('gitlab')">
              {{ $t('gitlab.configure') }}
            </ActionButton>
            <ActionButton variant="primary" @click="retry">
              {{ $t('common.retry') }}
            </ActionButton>
          </div>
        </div>
      </template>
    </DiffsPage>
  </main>
</template>
