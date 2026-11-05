<script setup lang="ts">
import type { GitlabConnection } from '../../state/settings'
import ActionButton from '@antfu/design/components/Action/ActionButton.vue'
import FormField from '@antfu/design/components/Form/FormField.vue'
import FormRadioGroup from '@antfu/design/components/Form/FormRadioGroup.vue'
import FormTextInput from '@antfu/design/components/Form/FormTextInput.vue'
import { createGitlabClient, normalizeGitlabInstance } from '@pulls.review/core/gitlab'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { gitlabTransport } from '../../gitlab-transport'

const props = defineProps<{ connections: GitlabConnection[] }>()
const emit = defineEmits<{ save: [connections: GitlabConnection[]] }>()
const { t } = useI18n()
const instance = ref('')
const token = ref('')
const transport = ref<GitlabConnection['transport']>('userscript')
const error = ref('')
const status = ref('')
const busy = ref(false)
const connectorUrl = `${import.meta.env.BASE_URL}gitlab-connector.user.js`

function save() {
  error.value = ''
  try {
    const normalized = normalizeGitlabInstance(instance.value)
    emit('save', [...props.connections.filter(item => item.instance !== normalized), { instance: normalized, token: token.value.trim(), transport: transport.value }])
    instance.value = ''
    token.value = ''
    status.value = t('gitlab.saved')
  }
  catch (err) {
    error.value = String(err)
  }
}

function edit(connection: GitlabConnection) {
  instance.value = connection.instance
  token.value = connection.token
  transport.value = connection.transport
  status.value = ''
}

async function test(connection: GitlabConnection) {
  busy.value = true
  status.value = ''
  error.value = ''
  try {
    const client = createGitlabClient(connection.instance, {
      githubToken: async () => undefined,
      gitlabToken: async () => connection.token || undefined,
    }, gitlabTransport(connection.instance, () => props.connections))
    await client.request(connection.token ? '/user' : '/projects?per_page=1')
    status.value = t('gitlab.connected')
  }
  catch (err) {
    error.value = String(err)
  }
  finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p class="text-sm color-muted">
      {{ $t('gitlab.description') }}
    </p>
    <a :href="connectorUrl" target="_blank" rel="noopener" class="text-primary hover:underline">{{ $t('gitlab.installConnector') }}</a>
    <div v-for="connection in connections" :key="connection.instance" class="flex flex-wrap items-center gap-2 border border-base rounded p-3">
      <span class="min-w-0 flex-1 break-all text-sm">{{ connection.instance }}</span>
      <ActionButton :disabled="busy" @click="test(connection)">
        {{ $t('gitlab.test') }}
      </ActionButton>
      <ActionButton variant="text" @click="edit(connection)">
        {{ $t('gitlab.edit') }}
      </ActionButton>
      <ActionButton variant="text" @click="emit('save', connections.filter(item => item.instance !== connection.instance))">
        {{ $t('common.remove') }}
      </ActionButton>
    </div>
    <FormField :label="$t('gitlab.instance')" :error="error">
      <FormTextInput v-model="instance" placeholder="https://gitlab.company.test" />
    </FormField>
    <FormField :label="$t('gitlab.token')" :description="$t('gitlab.tokenHint')">
      <FormTextInput v-model="token" type="password" autocomplete="off" placeholder="glpat-…" />
    </FormField>
    <FormField :label="$t('gitlab.connection')">
      <FormRadioGroup v-model="transport" :options="[{ value: 'userscript', label: $t('gitlab.userscript') }, { value: 'direct', label: $t('gitlab.direct') }]" />
    </FormField>
    <ActionButton variant="primary" :disabled="!instance.trim()" @click="save">
      {{ $t('common.save') }}
    </ActionButton>
    <p v-if="status" role="status" class="text-sm text-primary">
      {{ status }}
    </p>
    <p class="text-xs color-muted">
      {{ $t('gitlab.privacy') }}
    </p>
  </div>
</template>
