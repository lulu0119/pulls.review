import type { Meta, StoryObj } from '@storybook/vue3-vite'
import GitlabSettings from './GitlabSettings.vue'

const meta: Meta<typeof GitlabSettings> = { title: 'Settings/GitlabSettings', component: GitlabSettings }
export default meta
type Story = StoryObj<typeof GitlabSettings>
export const Empty: Story = { args: { connections: [] } }
export const Configured: Story = {
  args: { connections: [{ instance: 'https://gitlab.company.test', token: '', transport: 'userscript' }] },
}
