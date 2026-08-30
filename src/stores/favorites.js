import { defineStore } from 'pinia'

const STORAGE_KEY = 'craftora-favorites'

const readFavorites = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    const ids = [...new Set(raw.filter(id => Number.isInteger(id)))]
    if (ids.length !== raw.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    return ids
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return []
  }
}

export const useFavoritesStore = defineStore('favorites', {
  state: () => ({ ids: readFavorites() }),
  getters: { has: s => id => s.ids.includes(id) },
  actions: {
    persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ids)) },
    toggle(id) {
      this.ids = this.ids.includes(id) ? this.ids.filter(x => x !== id) : [...this.ids, id]
      this.persist()
    }
  }
})
