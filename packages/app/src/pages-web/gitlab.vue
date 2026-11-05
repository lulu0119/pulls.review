<script setup lang="ts">
import type { GitlabRef } from '@pulls.review/core/gitlab'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FeedbackLoading from '@antfu/design/components/Feedback/FeedbackLoading.vue'
import { createGitlabMergeRequestSource } from '@pulls.review/core/gitlab'
import { onMounted } from 'vue'
import { useAppContext } from '../app-context'
import DiffsPage from '../components/diff/DiffsPage.vue'
import { useDocumentTitle } from '../composables/useDocumentTitle'
import { gitlabTransport } from '../gitlab-transport'
import { settings } from '../state/settings'
import { openSettings } from '../state/settingsModal'
import { createDiffsStore } from '../stores/diffs-store'

const props = defineProps<{ sourceRef: GitlabRef }>()
const { cache, credentials, llm } = useAppContext()
const source = createGitlabMergeRequestSource(props.sourceRef, credentials, gitlabTransport(props.sourceRef.instance, () => settings.value.gitlab))
const store = createDiffsStore(source, { cache, llm })
useDocumentTitle(() => store.diff?.title ?? `${props.sourceRef.project}!${props.sourceRef.number}`)
onMounted(() => store.load())
</script>

<template>
  <main>
    <DiffsPage :store="store">
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
