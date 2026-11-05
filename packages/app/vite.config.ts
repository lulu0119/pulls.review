import process from 'node:process'
import Vue from '@vitejs/plugin-vue'
import UnoCSS from 'unocss/vite'
import { defineConfig } from 'vite'
import { alias, features } from './vite.config.shared'

export default defineConfig({
  base: process.env.VITE_GITHUB_PAGES ? '/pulls.review/' : '/',
  plugins: [
    Vue(),
    UnoCSS(),
  ],
  resolve: {
    alias,
  },
  define: features({ llm: true, embed: false }),
})
